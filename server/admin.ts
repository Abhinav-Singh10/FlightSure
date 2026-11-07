import { Router } from 'express';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import { pool } from './db.ts';
import { readAdmin } from './session.ts';
import { fail, meta } from './http.ts';
import { formatIst } from './time.ts';
import { readOperation, saveOperation } from './operations.ts';
import {
  expireFlightHolds,
  processFlightWaitlist,
  recoverBooking,
  releaseCheckout,
} from './allocations.ts';
import type { CancellationTask } from '../shared/types.ts';

export const admin = Router();
const flightPath = z.object({ flightId: z.string().uuid() }).strict();
const taskPath = z.object({ taskId: z.string().uuid() }).strict();
const cancellationBody = z.object({
  reason: z.string().trim().min(1).max(300),
}).strict();

type TaskRow = {
  id: string;
  flight_id: string;
  status: CancellationTask['status'];
  created_at: Date;
  completed_at: Date | null;
  error: string | null;
  affected_count: number;
  processed_count: number;
  rebooked_count: number;
  unassigned_count: number;
};

async function readTask(client: Pool | PoolClient, id: string): Promise<CancellationTask | null> {
  const result = await client.query<TaskRow>(
    `SELECT t.*, count(r.booking_id)::int AS affected_count,
       count(r.booking_id) FILTER (WHERE r.status <> 'PENDING')::int AS processed_count,
       count(r.booking_id) FILTER (WHERE r.status = 'REBOOKED')::int AS rebooked_count,
       count(r.booking_id) FILTER (WHERE r.status = 'UNASSIGNED')::int AS unassigned_count
     FROM cancellation_tasks t LEFT JOIN recovery_items r ON r.task_id = t.id
     WHERE t.id = $1 GROUP BY t.id`,
    [id],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: row.id,
    flightId: row.flight_id,
    status: row.status,
    affectedCount: row.affected_count,
    processedCount: row.processed_count,
    rebookedCount: row.rebooked_count,
    unassignedCount: row.unassigned_count,
    createdAt: formatIst(row.created_at),
    completedAt: row.completed_at ? formatIst(row.completed_at) : null,
    error: row.error,
  };
}

admin.use((_request, response, next) => {
  response.set('Cache-Control', 'no-store');
  next();
});

admin.get('/cancellations/:taskId', async (request, response) => {
  if (!await readAdmin(request, response)) return;
  z.object({}).strict().parse(request.query);
  const { taskId } = taskPath.parse(request.params);
  const task = await readTask(pool, taskId);
  if (!task) {
    fail(response, 404, 'CANCELLATION_NOT_FOUND', 'Cancellation task not found.');
    return;
  }
  response.json({ data: task, meta: meta() });
});

admin.post('/flights/:flightId/cancel', async (request, response) => {
  const user = await readAdmin(request, response);
  if (!user) return;
  z.object({}).strict().parse(request.query);
  const { flightId } = flightPath.parse(request.params);
  const input = cancellationBody.parse(request.body);
  const key = z.string().uuid().parse(request.get('Idempotency-Key'));
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const saved = await readOperation(client, user.id, 'CANCEL_FLIGHT', key, {
      flightId, reason: input.reason,
    });
    if (!saved.matches) {
      await client.query('ROLLBACK');
      fail(response, 409, 'IDEMPOTENCY_KEY_REUSED', 'Use a new key for a different cancellation.');
      return;
    }
    if (saved.data && saved.http_status) {
      await client.query('COMMIT');
      response.set('Idempotency-Replayed', 'true');
      response.status(saved.http_status).json({ data: saved.data, meta: meta() });
      return;
    }

    const flights = await client.query<{
      status: string; departure_at: Date; flight_number: string;
    }>(
      'SELECT status, departure_at, flight_number FROM flights WHERE id = $1 FOR UPDATE',
      [flightId],
    );
    const flight = flights.rows[0];
    if (!flight) {
      await client.query('ROLLBACK');
      fail(response, 404, 'FLIGHT_NOT_FOUND', 'Flight not found.');
      return;
    }
    const existing = await client.query<{ id: string; }>(
      'SELECT id FROM cancellation_tasks WHERE flight_id = $1', [flightId],
    );
    let taskId = existing.rows[0]?.id;
    if (!taskId) {
      const time = await client.query<{ checked_at: Date; }>('SELECT clock_timestamp() AS checked_at');
      const checkedAt = time.rows[0].checked_at;
      if (flight.status === 'DEPARTED' || flight.departure_at <= checkedAt) {
        await client.query('ROLLBACK');
        fail(response, 409, 'DEPARTURE_PASSED', 'This flight has already departed.');
        return;
      }
      await client.query("UPDATE flights SET status = 'CANCELLED' WHERE id = $1", [flightId]);
      const inserted = await client.query<{ id: string; }>(
        `INSERT INTO cancellation_tasks (flight_id, admin_id, reason, created_at)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [flightId, user.id, input.reason, checkedAt],
      );
      taskId = inserted.rows[0].id;

      await expireFlightHolds(client, flightId, checkedAt);
      const holds = await client.query<{ id: string; }>(
        `SELECT id FROM holds WHERE flight_id = $1
         AND status IN ('ACTIVE', 'PAYMENT_PENDING') ORDER BY id FOR UPDATE`,
        [flightId],
      );
      for (const hold of holds.rows) {
        await releaseCheckout(client, hold.id, 'RELEASED');
      }
      await processFlightWaitlist(client, flightId);

      const bookings = await client.query<{
        id: string; account_id: string; reference: string;
      }>(
        `SELECT id, account_id, reference FROM bookings
         WHERE current_flight_id = $1 AND status = 'CONFIRMED'
         ORDER BY confirmed_at, id FOR UPDATE`,
        [flightId],
      );
      for (const booking of bookings.rows) {
        await client.query(
          'INSERT INTO recovery_items (task_id, booking_id) VALUES ($1, $2)',
          [taskId, booking.id],
        );
        await client.query(
          'DELETE FROM seat_allocations WHERE booking_id = $1 AND flight_id = $2',
          [booking.id, flightId],
        );
        await client.query(
          `UPDATE bookings SET status = 'REBOOKING', current_flight_id = NULL,
             seat_id = NULL, cancellation_reason = $2 WHERE id = $1`,
          [booking.id, input.reason],
        );
        await client.query(
          `INSERT INTO notifications (account_id, event_key, type, message, flight_id, booking_id, created_at)
           VALUES ($1, $2, 'FLIGHT_CANCELLED', $3, $4, $5, $6)
           ON CONFLICT (account_id, event_key) DO NOTHING`,
          [booking.account_id, `cancellation:${taskId}:${booking.id}:FLIGHT_CANCELLED`,
          `${flight.flight_number} for booking ${booking.reference} was cancelled: ${input.reason} We’re looking for a replacement.`,
            flightId, booking.id, checkedAt],
        );
      }
    }
    const task = await readTask(client, taskId);
    if (!task) throw new Error('The cancellation task was not saved.');
    await saveOperation(client, user.id, 'CANCEL_FLIGHT', key, 202, task);
    await client.query('COMMIT');
    response.set('Idempotency-Replayed', 'false');
    response.status(202).json({ data: task, meta: meta() });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
});

async function finishTask(id: string) {
  await pool.query(
    `UPDATE cancellation_tasks t
     SET status = 'COMPLETED', completed_at = clock_timestamp(), error = NULL
     WHERE t.id = $1 AND t.status <> 'COMPLETED'
       AND NOT EXISTS (SELECT 1 FROM recovery_items r WHERE r.task_id = t.id AND r.status = 'PENDING')`,
    [id],
  );
}

export async function processRecoveries() {
  const tasks = await pool.query<{ id: string; flight_id: string; }>(
    `SELECT id, flight_id FROM cancellation_tasks WHERE status <> 'COMPLETED'
     ORDER BY last_attempt_at NULLS FIRST, created_at, id LIMIT 25`,
  );
  let remaining = 25;
  for (const task of tasks.rows) {
    if (remaining === 0) break;
    await pool.query(
      `UPDATE cancellation_tasks SET status = 'RUNNING', error = NULL,
         last_attempt_at = clock_timestamp() WHERE id = $1 AND status <> 'COMPLETED'`,
      [task.id],
    );
    try {
      const items = await pool.query<{ booking_id: string; }>(
        `SELECT r.booking_id FROM recovery_items r JOIN bookings b ON b.id = r.booking_id
         WHERE r.task_id = $1 AND r.status = 'PENDING'
         ORDER BY b.confirmed_at, b.id LIMIT $2`,
        [task.id, remaining],
      );
      for (const item of items.rows) {
        remaining -= 1;
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          await recoverBooking(client, task.id, item.booking_id, task.flight_id);
          await client.query('COMMIT');
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        } finally {
          client.release();
        }
      }
      await finishTask(task.id);
    } catch (error) {
      console.error('Recovery processing failed:', error);
      await pool.query(
        `UPDATE cancellation_tasks SET status = 'FAILED',
           error = 'Recovery could not finish. It will retry automatically.'
         WHERE id = $1 AND status <> 'COMPLETED'`,
        [task.id],
      );
    }
  }
}
