import { randomBytes } from 'node:crypto';
import type { Hold } from '../shared/types.ts';
import type { PoolClient } from 'pg';
import { pool } from './db.ts';

// The caller locks the flight first and owns the surrounding transaction.
export async function expireFlightHolds(client: PoolClient, flightId: string, checkedAt: Date) {
  const expired = await client.query<{ id: string }>(
    `UPDATE holds SET status = 'EXPIRED'
     WHERE flight_id = $1 AND status IN ('ACTIVE', 'PAYMENT_PENDING') AND expires_at <= $2
     RETURNING id`,
    [flightId, checkedAt],
  );
  // Match the exact old hold, so cleanup cannot remove a new owner's claim.
  await client.query('DELETE FROM seat_allocations WHERE hold_id = ANY($1::uuid[])',
    [expired.rows.map((hold) => hold.id)]);
}

export async function processExpiredHolds() {
  const candidates = await pool.query<{ flight_id: string }>(
    `SELECT DISTINCT flight_id FROM holds
     WHERE status IN ('ACTIVE', 'PAYMENT_PENDING') AND expires_at <= clock_timestamp()
     ORDER BY flight_id LIMIT 25`,
  );
  for (const candidate of candidates.rows) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT id FROM flights WHERE id = $1 FOR UPDATE', [candidate.flight_id]);
      const time = await client.query<{ checked_at: Date }>('SELECT clock_timestamp() AS checked_at');
      await expireFlightHolds(client, candidate.flight_id, time.rows[0].checked_at);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

export type CheckoutHold = {
  id: string; account_id: string; flight_id: string; seat_id: string;
  status: Hold['status']; source: Hold['source']; quote_paise: number; expires_at: Date;
};

export async function releaseCheckout(client: PoolClient, holdId: string, status: 'FAILED' | 'EXPIRED' | 'RELEASED') {
  await client.query(
    "UPDATE holds SET status = $2 WHERE id = $1 AND status IN ('ACTIVE', 'PAYMENT_PENDING')",
    [holdId, status],
  );
  await client.query('DELETE FROM seat_allocations WHERE hold_id = $1', [holdId]);
}

// Caller holds the flight lock. Booking, assignment, claim and payment commit together.
export async function confirmCheckout(client: PoolClient, hold: CheckoutHold, paymentId: string, confirmedAt: Date) {
  let bookingId = '';
  while (!bookingId) {
    const reference = 'FS' + randomBytes(4).toString('hex').toUpperCase();
    const result = await client.query<{ id: string }>(
      `INSERT INTO bookings (payment_id, account_id, reference, original_flight_id, current_flight_id, seat_id, fare_paid_paise, confirmed_at)
       VALUES ($1, $2, $3, $4, $4, $5, $6, $7)
       ON CONFLICT (reference) DO NOTHING RETURNING id`,
      [paymentId, hold.account_id, reference, hold.flight_id, hold.seat_id, hold.quote_paise, confirmedAt],
    );
    bookingId = result.rows[0]?.id ?? '';
  }
  await client.query(
    'INSERT INTO booking_assignments (booking_id, flight_id, seat_id, assigned_at) VALUES ($1, $2, $3, $4)',
    [bookingId, hold.flight_id, hold.seat_id, confirmedAt],
  );
  const claim = await client.query(
    `UPDATE seat_allocations SET hold_id = NULL, booking_id = $1
     WHERE hold_id = $2 AND account_id = $3 AND flight_id = $4 AND seat_id = $5`,
    [bookingId, hold.id, hold.account_id, hold.flight_id, hold.seat_id],
  );
  if (claim.rowCount !== 1) throw new Error('The checkout no longer owns its seat.');
  await client.query("UPDATE holds SET status = 'CONSUMED' WHERE id = $1", [hold.id]);
  return bookingId;
}
