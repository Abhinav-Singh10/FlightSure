import { Router } from 'express';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import { pool } from './db.ts';
import { readPassenger } from './session.ts';
import { fail, meta } from './http.ts';
import { formatIst } from './time.ts';
import { readOperation, saveOperation } from './operations.ts';
import { confirmCheckout, expireFlightHolds, releaseCheckout } from './allocations.ts';
import type { CheckoutHold } from './allocations.ts';
import type { Payment } from '../shared/types.ts';

export const payments = Router();
const holdPath = z.object({ holdId: z.string().uuid() }).strict();
const paymentPath = z.object({ paymentId: z.string().uuid() }).strict();
const paymentBody = z.object({
  outcome: z.enum(['SUCCESS', 'FAILURE', 'DELAYED_SUCCESS']),
  delaySeconds: z.number().int().min(1).max(600).optional(),
  passengerName: z.string().trim().min(1).max(100).optional(),
  passengerAge: z.number().int().min(1).max(120).optional(),
}).strict();

type PaymentRow = {
  id: string; hold_id: string; status: Payment['status']; amount_paise: number;
  requested_outcome: string; created_at: Date; due_at: Date;
  completed_at: Date | null; reason: string | null; booking_id: string | null;
};
const paymentSelect = `SELECT p.*, b.id AS booking_id FROM payments p LEFT JOIN bookings b ON b.payment_id = p.id`;

function formatPayment(row: PaymentRow): Payment {
  return {
    id: row.id, holdId: row.hold_id, status: row.status,
    amount: { amountMinor: row.amount_paise, currency: 'INR' },
    bookingId: row.booking_id, reason: row.reason,
    createdAt: formatIst(row.created_at), completedAt: row.completed_at ? formatIst(row.completed_at) : null,
  };
}

async function readPayment(client: Pool | PoolClient, id: string, accountId: string) {
  const result = await client.query<PaymentRow>(
    `${paymentSelect} JOIN holds h ON h.id = p.hold_id WHERE p.id = $1 AND h.account_id = $2`, [id, accountId],
  );
  return result.rows[0] ? formatPayment(result.rows[0]) : null;
}

payments.get('/payments/:paymentId', async (request, response) => {
  response.set('Cache-Control', 'no-store');
  const user = await readPassenger(request, response);
  if (!user) return;
  z.object({}).strict().parse(request.query);
  const { paymentId } = paymentPath.parse(request.params);
  const payment = await readPayment(pool, paymentId, user.id);
  if (!payment) { fail(response, 404, 'PAYMENT_NOT_FOUND', 'Payment not found.'); return; }
  response.json({ data: payment, meta: meta() });
});

payments.post('/holds/:holdId/payments', async (request, response) => {
  response.set('Cache-Control', 'no-store');
  const user = await readPassenger(request, response);
  if (!user) return;
  z.object({}).strict().parse(request.query);
  const { holdId } = holdPath.parse(request.params);
  const key = z.string().uuid().parse(request.get('Idempotency-Key'));
  const input = paymentBody.parse(request.body);
  if ((input.passengerName === undefined) !== (input.passengerAge === undefined)) {
    fail(response, 400, 'VALIDATION_ERROR', 'Provide both passenger name and age.'); return;
  }
  if (input.outcome !== 'DELAYED_SUCCESS' && input.delaySeconds !== undefined) {
    fail(response, 400, 'VALIDATION_ERROR', 'Only delayed success accepts a delay.'); return;
  }
  const delay = input.outcome === 'DELAYED_SUCCESS' ? input.delaySeconds ?? 30 : null;
  const owned = await pool.query<{ flight_id: string }>('SELECT flight_id FROM holds WHERE id = $1 AND account_id = $2', [holdId, user.id]);
  if (!owned.rows[0]) { fail(response, 404, 'HOLD_NOT_FOUND', 'Hold not found.'); return; }
  const flightId = owned.rows[0].flight_id;
  // Optional fields preserve retries made by the earlier checkout.
  const payload = { holdId, ...input, delaySeconds: delay };
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const saved = await readOperation(client, user.id, 'START_PAYMENT', key, payload);
    if (!saved.matches) {
      await client.query('ROLLBACK');
      fail(response, 409, 'IDEMPOTENCY_KEY_REUSED', 'Use a new key for a different payment request.'); return;
    }
    if (saved.data && saved.http_status) {
      await client.query('COMMIT');
      response.set('Idempotency-Replayed', 'true');
      response.status(saved.http_status).json({ data: saved.data, meta: meta() }); return;
    }
    const flights = await client.query<{ status: string; departure_at: Date }>(
      'SELECT status, departure_at FROM flights WHERE id = $1 FOR UPDATE', [flightId]);
    const holds = await client.query<CheckoutHold>('SELECT * FROM holds WHERE id = $1 AND account_id = $2 FOR UPDATE', [holdId, user.id]);
    const hold = holds.rows[0];
    const existing = await client.query<{ id: string }>('SELECT id FROM payments WHERE hold_id = $1', [holdId]);
    if (existing.rows[0]) {
      await client.query('ROLLBACK');
      fail(response, 409, 'PAYMENT_ALREADY_STARTED', 'This hold already has a payment.', [], existing.rows[0].id); return;
    }
    const time = await client.query<{ checked_at: Date }>('SELECT clock_timestamp() AS checked_at');
    const checkedAt = time.rows[0].checked_at;
    const flight = flights.rows[0];
    let code = '';
    let message = '';
    if (hold.expires_at <= checkedAt) { code = 'HOLD_EXPIRED'; message = 'Your seat hold has expired.'; }
    else if (hold.status !== 'ACTIVE') { code = 'HOLD_NOT_ACTIVE'; message = 'This hold cannot start another checkout.'; }
    else if (flight.status !== 'SCHEDULED' || flight.departure_at <= checkedAt) { code = 'FLIGHT_NOT_BOOKABLE'; message = 'This flight is no longer bookable.'; }
    else if (hold.source === 'WAITLIST') { code = 'OFFER_NOT_ACCEPTED'; message = 'Accept your waitlist offer first.'; }
    const claim = await client.query('SELECT seat_id FROM seat_allocations WHERE hold_id = $1 AND account_id = $2 AND flight_id = $3 AND seat_id = $4',
      [hold.id, user.id, flightId, hold.seat_id]);
    if (!code && !claim.rowCount) { code = 'HOLD_NOT_ACTIVE'; message = 'This hold no longer owns its seat.'; }
    if (code) { await client.query('ROLLBACK'); fail(response, 409, code, message); return; }
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO payments (hold_id, amount_paise, requested_outcome, delay_seconds, created_at, due_at, passenger_name, passenger_age)
       VALUES ($1, $2, $3, $4, $5, $5::timestamptz + COALESCE($4::int, 0) * interval '1 second', $6, $7) RETURNING id`,
      [holdId, hold.quote_paise, input.outcome, delay, checkedAt, input.passengerName ?? null, input.passengerAge ?? null],
    );
    await client.query("UPDATE holds SET status = 'PAYMENT_PENDING' WHERE id = $1", [holdId]);
    const payment = await readPayment(client, inserted.rows[0].id, user.id);
    if (!payment) throw new Error('The payment was not saved.');
    await saveOperation(client, user.id, 'START_PAYMENT', key, 202, payment);
    await client.query('COMMIT');
    response.set('Idempotency-Replayed', 'false');
    response.status(202).json({ data: payment, meta: meta() });
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
});

export async function processDuePayments() {
  const candidates = await pool.query<{ id: string; hold_id: string; flight_id: string }>(
    `SELECT p.id, p.hold_id, h.flight_id FROM payments p JOIN holds h ON h.id = p.hold_id
     WHERE p.status = 'PENDING' AND p.due_at <= clock_timestamp() ORDER BY p.due_at, p.id LIMIT 25`,
  );
  for (const candidate of candidates.rows) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const flights = await client.query<{ status: string; departure_at: Date }>(
        'SELECT status, departure_at FROM flights WHERE id = $1 FOR UPDATE', [candidate.flight_id]);
      const holds = await client.query<CheckoutHold>('SELECT * FROM holds WHERE id = $1 FOR UPDATE', [candidate.hold_id]);
      const result = await client.query<PaymentRow>('SELECT * FROM payments WHERE id = $1 FOR UPDATE', [candidate.id]);
      const payment = result.rows[0];
      if (payment.status !== 'PENDING') { await client.query('COMMIT'); continue; }
      const hold = holds.rows[0];
      const claims = await client.query('SELECT seat_id FROM seat_allocations WHERE hold_id = $1 AND account_id = $2 AND flight_id = $3 AND seat_id = $4 FOR UPDATE',
        [hold.id, hold.account_id, hold.flight_id, hold.seat_id]);
      const time = await client.query<{ checked_at: Date }>('SELECT clock_timestamp() AS checked_at');
      const checkedAt = time.rows[0].checked_at;
      if (payment.due_at > checkedAt) { await client.query('COMMIT'); continue; }
      await expireFlightHolds(client, hold.flight_id, checkedAt);
      const flight = flights.rows[0];
      if (payment.requested_outcome === 'FAILURE') {
        await releaseCheckout(client, hold.id, 'FAILED');
        await client.query("UPDATE payments SET status = 'FAILED', completed_at = $2, reason = 'Simulated payment failure.' WHERE id = $1", [payment.id, checkedAt]);
      } else {
        const valid = hold.status === 'PAYMENT_PENDING' && hold.expires_at > checkedAt
          && flight.status === 'SCHEDULED' && flight.departure_at > checkedAt && claims.rowCount === 1 && hold.source === 'DIRECT';
        if (valid) {
          if (payment.amount_paise !== hold.quote_paise) throw new Error('Payment and hold amounts differ.');
          await confirmCheckout(client, hold, payment.id, checkedAt);
          await client.query("UPDATE payments SET status = 'SUCCEEDED', completed_at = $2 WHERE id = $1", [payment.id, checkedAt]);
        } else {
          const expired = hold.expires_at <= checkedAt || flight.departure_at <= checkedAt;
          await releaseCheckout(client, hold.id, expired ? 'EXPIRED' : flight.status !== 'SCHEDULED' ? 'RELEASED' : 'FAILED');
          await client.query("UPDATE payments SET status = 'VOIDED', completed_at = $2, reason = 'The hold expired or the flight or seat is no longer available.' WHERE id = $1", [payment.id, checkedAt]);
        }
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Payment processing failed:', error);
    } finally { client.release(); }
  }
}
