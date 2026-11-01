import { Router } from 'express';
import type { Request, Response } from 'express';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import { pool } from './db.ts';
import { readPassenger } from './session.ts';
import { fail, meta } from './http.ts';
import { formatIst } from './time.ts';
import { processFlightWaitlist } from './allocations.ts';
import { readOperation, saveOperation } from './operations.ts';
import type { Hold } from '../shared/types.ts';

export const holds = Router();
const createBody = z.object({ flightId: z.string().uuid(), seatId: z.string().uuid() }).strict();
const holdPath = z.object({ holdId: z.string().uuid() }).strict();
const operationKey = z.string().uuid();

type HoldRow = {
  id: string; flight_id: string; seat_id: string; label: string;
  payment_id: string | null; booking_id: string | null;
  waitlist_entry_id: string | null;
  source: Hold['source']; status: Hold['status']; expires_at: Date; quote_paise: number;
};
type HoldResult = { hold: Hold } | { code: string; message: string; status: number; existingId?: string };
type FlightRow = { id: string; status: string; departure_at: Date; fare_paise: number };

const holdSelect = `SELECT h.id, h.flight_id, h.seat_id, s.label, h.source, h.quote_paise, h.expires_at, p.id AS payment_id, b.id AS booking_id, w.id AS waitlist_entry_id,
  CASE WHEN h.status IN ('ACTIVE', 'PAYMENT_PENDING') AND h.expires_at <= clock_timestamp()
    THEN 'EXPIRED' ELSE h.status END AS status
  FROM holds h JOIN flight_seats s ON s.id = h.seat_id
  LEFT JOIN payments p ON p.hold_id = h.id LEFT JOIN bookings b ON b.payment_id = p.id
  LEFT JOIN waitlist_entries w ON w.offer_hold_id = h.id`;

function formatHold(row: HoldRow): Hold {
  return {
    id: row.id, flightId: row.flight_id, seat: { id: row.seat_id, label: row.label },
    source: row.source, status: row.status, expiresAt: formatIst(row.expires_at),
    quote: { amountMinor: row.quote_paise, currency: 'INR' },
    waitlistEntryId: row.waitlist_entry_id, paymentId: row.payment_id, bookingId: row.booking_id,
  };
}

holds.use((request, response, next) => {
  response.set('Cache-Control', 'no-store');
  z.object({}).strict().parse(request.query);
  next();
});

export async function readHold(client: Pool | PoolClient, holdId: string, accountId: string) {
  const result = await client.query<HoldRow>(`${holdSelect} WHERE h.id = $1 AND h.account_id = $2`, [holdId, accountId]);
  return result.rows[0] ? formatHold(result.rows[0]) : null;
}

holds.get('/:holdId', async (request, response) => {
  const user = await readPassenger(request, response);
  if (!user) return;
  const { holdId } = holdPath.parse(request.params);
  const hold = await readHold(pool, holdId, user.id);
  if (!hold) {
    fail(response, 404, 'HOLD_NOT_FOUND', 'Hold not found.');
    return;
  }
  response.json({ data: hold, meta: meta() });
});

async function createHold(
  client: PoolClient, accountId: string, flight: FlightRow, seatId: string, checkedAt: Date,
): Promise<HoldResult> {
  if (flight.status !== 'SCHEDULED' || flight.departure_at <= checkedAt) {
    return { status: 409, code: 'FLIGHT_NOT_BOOKABLE', message: 'This flight is no longer bookable.' };
  }
  const seats = await client.query('SELECT id FROM flight_seats WHERE id = $1 AND flight_id = $2', [seatId, flight.id]);
  if (!seats.rowCount) return { status: 404, code: 'SEAT_NOT_FOUND', message: 'Seat not found on this flight.' };
  const current = await client.query<{ hold_id: string | null; booking_id: string | null }>(
    'SELECT hold_id, booking_id FROM seat_allocations WHERE account_id = $1 AND flight_id = $2', [accountId, flight.id],
  );
  if (current.rows[0]?.booking_id) {
    return { status: 409, code: 'ALREADY_BOOKED', message: 'You already have a booking on this flight.', existingId: current.rows[0].booking_id };
  }
  if (current.rows[0]?.hold_id) {
    return { status: 409, code: 'ACTIVE_HOLD_EXISTS', message: 'You already hold a seat on this flight.', existingId: current.rows[0].hold_id };
  }
  const occupied = await client.query('SELECT seat_id FROM seat_allocations WHERE seat_id = $1', [seatId]);
  if (occupied.rowCount) return { status: 409, code: 'SEAT_UNAVAILABLE', message: 'That seat was just taken. Please choose another.' };
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO holds (account_id, flight_id, seat_id, quote_paise, created_at, expires_at)
     VALUES ($1, $2, $3, $4, $5, LEAST($5::timestamptz + interval '5 minutes', $6::timestamptz)) RETURNING id`,
    [accountId, flight.id, seatId, flight.fare_paise, checkedAt, flight.departure_at],
  );
  const holdId = inserted.rows[0].id;
  await client.query('INSERT INTO seat_allocations (seat_id, flight_id, account_id, hold_id) VALUES ($1, $2, $3, $4)',
    [seatId, flight.id, accountId, holdId]);
  const result = await client.query<HoldRow>(`${holdSelect} WHERE h.id = $1`, [holdId]);
  return { hold: formatHold(result.rows[0]) };
}

async function releaseHold(client: PoolClient, accountId: string, holdId: string): Promise<HoldResult> {
  const result = await client.query<HoldRow>(`${holdSelect} WHERE h.id = $1 AND h.account_id = $2`, [holdId, accountId]);
  const row = result.rows[0];
  if (!row) return { status: 404, code: 'HOLD_NOT_FOUND', message: 'Hold not found.' };
  if (row.source === 'WAITLIST') return { status: 409, code: 'USE_WAITLIST_WITHDRAWAL', message: 'Withdraw the waitlist offer instead.' };
  if (row.status === 'PAYMENT_PENDING') return { status: 409, code: 'PAYMENT_IN_PROGRESS', message: 'Payment is already in progress.' };
  if (row.status === 'CONSUMED') return { status: 409, code: 'HOLD_ALREADY_CONSUMED', message: 'This hold has already become a booking.' };
  if (row.status === 'ACTIVE') {
    await client.query('DELETE FROM seat_allocations WHERE hold_id = $1', [holdId]);
    await client.query("UPDATE holds SET status = 'RELEASED' WHERE id = $1", [holdId]);
    row.status = 'RELEASED';
  }
  return { hold: formatHold(row) };
}

// Both mutations use the same order: request key, flight lock, then hold/claim.
async function changeHold(request: Request, response: Response) {
  const user = await readPassenger(request, response);
  if (!user) return;
  const key = operationKey.parse(request.get('Idempotency-Key'));
  const releasing = request.method === 'DELETE';
  const input = releasing ? null : createBody.parse(request.body);
  let holdId = '';
  let flightId = input?.flightId ?? '';
  if (releasing) {
    holdId = holdPath.parse(request.params).holdId;
    z.object({}).strict().optional().parse(request.body);
    const owned = await pool.query<{ flight_id: string }>('SELECT flight_id FROM holds WHERE id = $1 AND account_id = $2', [holdId, user.id]);
    if (!owned.rows[0]) {
      fail(response, 404, 'HOLD_NOT_FOUND', 'Hold not found.');
      return;
    }
    flightId = owned.rows[0].flight_id;
  }
  const operation = releasing ? 'RELEASE_HOLD' : 'CREATE_HOLD';
  const payload = input ?? { holdId };
  const status = releasing ? 200 : 201;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const saved = await readOperation(client, user.id, operation, key, payload);
    if (!saved.matches) {
      await client.query('ROLLBACK');
      fail(response, 409, 'IDEMPOTENCY_KEY_REUSED', 'Use a new request key for a different action.');
      return;
    }
    if (saved.data && saved.http_status) {
      await client.query('COMMIT');
      response.set('Idempotency-Replayed', 'true');
      response.status(saved.http_status).json({ data: saved.data, meta: meta() });
      return;
    }
    const flights = await client.query<FlightRow>('SELECT id, status, departure_at, fare_paise FROM flights WHERE id = $1 FOR UPDATE', [flightId]);
    const flight = flights.rows[0];
    if (!flight) {
      await client.query('ROLLBACK');
      fail(response, 404, 'FLIGHT_NOT_FOUND', 'Flight not found.');
      return;
    }
    await processFlightWaitlist(client, flightId);
    // now() is fixed at BEGIN; sample the real time after any lock wait.
    const time = await client.query<{ checked_at: Date }>('SELECT clock_timestamp() AS checked_at');
    const checkedAt = time.rows[0].checked_at;
    const result = input
      ? await createHold(client, user.id, flight, input.seatId, checkedAt)
      : await releaseHold(client, user.id, holdId);
    if ('code' in result) {
      await client.query('ROLLBACK');
      fail(response, result.status, result.code, result.message, [], result.existingId ?? null);
      return;
    }
    if (releasing) await processFlightWaitlist(client, flightId);
    await saveOperation(client, user.id, operation, key, status, result.hold);
    await client.query('COMMIT');
    response.set('Idempotency-Replayed', 'false');
    response.status(status).json({ data: result.hold, meta: meta() });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

holds.post('/', changeHold);
holds.delete('/:holdId', changeHold);
