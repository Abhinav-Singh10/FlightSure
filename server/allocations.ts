import { randomBytes } from 'node:crypto';
import type { Hold } from '../shared/types.ts';
import type { PoolClient } from 'pg';
import { pool } from './db.ts';
import { formatIst } from './time.ts';

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
  await client.query("UPDATE waitlist_entries SET status = 'EXPIRED' WHERE status = 'OFFERED' AND offer_hold_id = ANY($1::uuid[])",
    [expired.rows.map((hold) => hold.id)]);
}

// Every caller already holds the flight lock. Offers and released capacity commit together.
export async function processFlightWaitlist(client: PoolClient, flightId: string) {
  const result = await client.query<{ status: string; departure_at: Date; fare_paise: number; flight_number: string }>(
    'SELECT status, departure_at, fare_paise, flight_number FROM flights WHERE id = $1', [flightId]);
  const flight = result.rows[0];
  const time = await client.query<{ checked_at: Date }>('SELECT clock_timestamp() AS checked_at');
  await expireFlightHolds(client, flightId, time.rows[0].checked_at);
  if (flight.status !== 'SCHEDULED' || flight.departure_at <= time.rows[0].checked_at) {
    const offers = await client.query<{ offer_hold_id: string }>("SELECT offer_hold_id FROM waitlist_entries WHERE flight_id = $1 AND status = 'OFFERED'", [flightId]);
    for (const offer of offers.rows) await releaseCheckout(client, offer.offer_hold_id, 'RELEASED');
    await client.query("UPDATE waitlist_entries SET status = 'CLOSED' WHERE flight_id = $1 AND status = 'WAITING'", [flightId]);
    return;
  }
  const unusable = await client.query<{ offer_hold_id: string }>(`SELECT w.offer_hold_id FROM waitlist_entries w JOIN holds h ON h.id = w.offer_hold_id
    WHERE w.flight_id = $1 AND w.status = 'OFFERED' AND (h.status NOT IN ('ACTIVE', 'PAYMENT_PENDING')
      OR NOT EXISTS (SELECT 1 FROM seat_allocations a WHERE a.hold_id = h.id AND a.seat_id = h.seat_id AND a.account_id = h.account_id AND a.flight_id = h.flight_id))`, [flightId]);
  for (const offer of unusable.rows) await releaseCheckout(client, offer.offer_hold_id, 'FAILED');
  await client.query(`UPDATE waitlist_entries w SET status = 'CLOSED'
    WHERE w.flight_id = $1 AND w.status = 'WAITING' AND EXISTS (
      SELECT 1 FROM seat_allocations a WHERE a.flight_id = w.flight_id AND a.account_id = w.account_id)`, [flightId]);
  const seats = await client.query<{ id: string }>(`SELECT s.id FROM flight_seats s
    WHERE s.flight_id = $1 AND NOT EXISTS (SELECT 1 FROM seat_allocations a WHERE a.seat_id = s.id)
    ORDER BY s.row_number, s.column_letter, s.id`, [flightId]);
  if (!seats.rowCount) return;
  const waiting = await client.query<{ id: string; account_id: string }>(
    "SELECT id, account_id FROM waitlist_entries WHERE flight_id = $1 AND status = 'WAITING' ORDER BY joined_at, id LIMIT $2 FOR UPDATE",
    [flightId, seats.rows.length]);
  for (const [index, entry] of waiting.rows.entries()) {
    // Sample again after row locks; acceptance and retries never reset this deadline.
    const now = await client.query<{ checked_at: Date }>('SELECT clock_timestamp() AS checked_at');
    const checkedAt = now.rows[0].checked_at;
    if (flight.departure_at <= checkedAt) break;
    const seat = seats.rows[index];
    const hold = await client.query<{ id: string }>(`INSERT INTO holds
      (account_id, flight_id, seat_id, source, quote_paise, created_at, expires_at)
      VALUES ($1, $2, $3, 'WAITLIST', $4, $5, LEAST($5::timestamptz + interval '5 minutes', $6::timestamptz)) RETURNING id`,
    [entry.account_id, flightId, seat.id, flight.fare_paise, checkedAt, flight.departure_at]);
    const holdId = hold.rows[0].id;
    await client.query('INSERT INTO seat_allocations (seat_id, flight_id, account_id, hold_id) VALUES ($1, $2, $3, $4)',
      [seat.id, flightId, entry.account_id, holdId]);
    await client.query("UPDATE waitlist_entries SET status = 'OFFERED', offer_hold_id = $2 WHERE id = $1", [entry.id, holdId]);
    await client.query(`INSERT INTO notifications (account_id, event_key, type, message, flight_id, waitlist_entry_id, created_at)
      VALUES ($1, $2, 'WAITLIST_OFFER', $3, $4, $5, $6) ON CONFLICT (account_id, event_key) DO NOTHING`,
    [entry.account_id, `waitlist-offer:${entry.id}`, `A seat is available on ${flight.flight_number}. Open your offer to accept it before it expires.`, flightId, entry.id, checkedAt]);
  }
}

export async function processWaitlists() {
  // Full queues need no work. Persisted entries are sufficient to resume after restart.
  const candidates = await pool.query<{ flight_id: string }>(`SELECT DISTINCT w.flight_id
    FROM waitlist_entries w JOIN flights f ON f.id = w.flight_id
    WHERE w.status IN ('WAITING', 'OFFERED') AND (
      f.status <> 'SCHEDULED' OR f.departure_at <= clock_timestamp()
      OR (w.status = 'OFFERED' AND EXISTS (SELECT 1 FROM holds h WHERE h.id = w.offer_hold_id AND
        (h.expires_at <= clock_timestamp() OR h.status NOT IN ('ACTIVE', 'PAYMENT_PENDING')
          OR NOT EXISTS (SELECT 1 FROM seat_allocations a WHERE a.hold_id = h.id))))
      OR (w.status = 'WAITING' AND (EXISTS (SELECT 1 FROM seat_allocations a WHERE a.flight_id = w.flight_id AND a.account_id = w.account_id)
        OR EXISTS (SELECT 1 FROM flight_seats s WHERE s.flight_id = w.flight_id AND NOT EXISTS (SELECT 1 FROM seat_allocations a WHERE a.seat_id = s.id)))))
    ORDER BY w.flight_id LIMIT 25`);
  for (const candidate of candidates.rows) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT id FROM flights WHERE id = $1 FOR UPDATE', [candidate.flight_id]);
      await processFlightWaitlist(client, candidate.flight_id);
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
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
      await processFlightWaitlist(client, candidate.flight_id);
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

export async function acceptedCheckout(client: PoolClient, hold: CheckoutHold) {
  if (hold.source === 'DIRECT') return true;
  const result = await client.query<{ accepted_at: Date | null }>(
    "SELECT accepted_at FROM waitlist_entries WHERE offer_hold_id = $1 AND account_id = $2 AND flight_id = $3 AND status = 'OFFERED' FOR UPDATE",
    [hold.id, hold.account_id, hold.flight_id]);
  return result.rows[0]?.accepted_at != null;
}

export async function releaseCheckout(client: PoolClient, holdId: string, status: 'FAILED' | 'EXPIRED' | 'RELEASED') {
  await client.query(
    "UPDATE holds SET status = $2 WHERE id = $1 AND status IN ('ACTIVE', 'PAYMENT_PENDING')",
    [holdId, status],
  );
  await client.query('DELETE FROM seat_allocations WHERE hold_id = $1', [holdId]);
  await client.query(`UPDATE waitlist_entries SET status = CASE
    WHEN EXISTS (SELECT 1 FROM holds WHERE id = $1 AND status = 'EXPIRED') THEN 'EXPIRED' ELSE 'CLOSED' END
    WHERE offer_hold_id = $1 AND status = 'OFFERED'`, [holdId]);
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
  if (hold.source === 'WAITLIST') {
    const fulfilled = await client.query("UPDATE waitlist_entries SET status = 'FULFILLED', booking_id = $2 WHERE offer_hold_id = $1 AND status = 'OFFERED' AND accepted_at IS NOT NULL", [hold.id, bookingId]);
    if (fulfilled.rowCount !== 1) throw new Error('The waitlist offer is no longer accepted.');
  }
  return bookingId;
}

// Caller owns the transaction. Lock every possible departure in UUID order before
// the booking, so two recoveries never acquire the same flights in opposite orders.
export async function recoverBooking(client: PoolClient, taskId: string, bookingId: string, cancelledFlightId: string) {
  const original = await client.query<{ origin: string; destination: string; departure_at: Date }>(
    'SELECT f.origin, f.destination, f.departure_at FROM bookings b JOIN flights f ON f.id = b.original_flight_id WHERE b.id = $1', [bookingId]);
  const anchor = original.rows[0];
  if (!anchor) throw new Error('The recovery booking was not found.');
  const flights = await client.query<{ id: string; origin: string; destination: string; departure_at: Date; status: string; flight_number: string }>(
    `SELECT id, origin, destination, departure_at, status, flight_number FROM flights
     WHERE id = $1 OR (origin = $2 AND destination = $3 AND departure_at BETWEEN $4::timestamptz AND $4::timestamptz + interval '24 hours')
     ORDER BY id FOR UPDATE`, [cancelledFlightId, anchor.origin, anchor.destination, anchor.departure_at]);
  const bookings = await client.query<{ id: string; account_id: string; reference: string; status: string }>(
    'SELECT id, account_id, reference, status FROM bookings WHERE id = $1 FOR UPDATE', [bookingId]);
  const items = await client.query<{ status: string }>('SELECT status FROM recovery_items WHERE task_id = $1 AND booking_id = $2 FOR UPDATE', [taskId, bookingId]);
  if (!items.rows[0] || items.rows[0].status !== 'PENDING') return;
  const booking = bookings.rows[0];
  if (!booking || booking.status !== 'REBOOKING') throw new Error('The booking is not awaiting recovery.');
  const task = await client.query<{ reason: string }>('SELECT reason FROM cancellation_tasks WHERE id = $1', [taskId]);
  const history = await client.query<{ flight_id: string }>('SELECT flight_id FROM booking_assignments WHERE booking_id = $1', [bookingId]);
  const candidates = flights.rows.filter((flight) => flight.origin === anchor.origin && flight.destination === anchor.destination
    && flight.departure_at >= anchor.departure_at && flight.departure_at.getTime() <= anchor.departure_at.getTime() + 24 * 60 * 60 * 1000
    && flight.status === 'SCHEDULED' && !history.rows.some((assigned) => assigned.flight_id === flight.id));
  candidates.sort((a, b) => a.departure_at.getTime() - b.departure_at.getTime() || a.id.localeCompare(b.id));
  let replacement: { id: string; departure_at: Date; flight_number: string } | null = null;
  for (const flight of candidates) {
    await processFlightWaitlist(client, flight.id);
    const time = await client.query<{ checked_at: Date }>('SELECT clock_timestamp() AS checked_at');
    if (flight.departure_at <= time.rows[0].checked_at) continue;
    const owned = await client.query('SELECT seat_id FROM seat_allocations WHERE flight_id = $1 AND account_id = $2', [flight.id, booking.account_id]);
    if (owned.rowCount) continue;
    const seats = await client.query<{ id: string }>(`SELECT s.id FROM flight_seats s WHERE s.flight_id = $1
      AND NOT EXISTS (SELECT 1 FROM seat_allocations a WHERE a.seat_id = s.id)
      ORDER BY s.row_number, s.column_letter, s.id LIMIT 1`, [flight.id]);
    const seat = seats.rows[0];
    if (!seat) continue;
    await client.query("UPDATE bookings SET status = 'CONFIRMED', current_flight_id = $2, seat_id = $3, cancellation_reason = NULL WHERE id = $1", [bookingId, flight.id, seat.id]);
    await client.query('INSERT INTO booking_assignments (booking_id, flight_id, seat_id, assigned_at) VALUES ($1, $2, $3, $4)',
      [bookingId, flight.id, seat.id, time.rows[0].checked_at]);
    await client.query('INSERT INTO seat_allocations (seat_id, flight_id, account_id, booking_id) VALUES ($1, $2, $3, $4)', [seat.id, flight.id, booking.account_id, bookingId]);
    replacement = flight;
    break;
  }
  if (!replacement) {
    await client.query("UPDATE bookings SET status = 'UNASSIGNED', current_flight_id = NULL, seat_id = NULL, cancellation_reason = $2 WHERE id = $1", [bookingId, task.rows[0].reason]);
  }
  const outcome = replacement ? 'REBOOKED' : 'UNASSIGNED';
  const type = replacement ? 'REBOOKED' : 'NO_ALTERNATIVE';
  await client.query('UPDATE recovery_items SET status = $3 WHERE task_id = $1 AND booking_id = $2', [taskId, bookingId, outcome]);
  const message = replacement
    ? `Booking ${booking.reference} has moved to ${replacement.flight_number}, departing ${formatIst(replacement.departure_at)} IST. Your reference and paid fare stay the same.`
    : `No replacement was available for booking ${booking.reference} within 24 hours of its original departure. Your booking remains in My bookings without a seat assignment.`;
  await client.query(`INSERT INTO notifications (account_id, event_key, type, message, flight_id, booking_id, created_at)
    VALUES ($1, $2, $3, $4, $5, $6, clock_timestamp()) ON CONFLICT (account_id, event_key) DO NOTHING`,
  [booking.account_id, `cancellation:${taskId}:${bookingId}:${type}`, type, message, replacement?.id ?? cancelledFlightId, bookingId]);
}
