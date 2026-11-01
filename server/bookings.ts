import { Router } from 'express';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import { pool } from './db.ts';
import { readPassenger } from './session.ts';
import { fail, meta } from './http.ts';
import { formatIst } from './time.ts';
import { flightData, flightSelect } from './flights.ts';
import type { FlightRow } from './flights.ts';
import { readOperation, saveOperation } from './operations.ts';
import type { Booking } from '../shared/types.ts';
import { processFlightWaitlist } from './allocations.ts';

export const bookings = Router();
const bookingPath = z.object({ bookingId: z.string().uuid() }).strict();
const listQuery = z.object({ page: z.string().optional(), limit: z.string().optional() }).strict();

type BookingRow = {
  id: string; reference: string; status: Booking['status']; account_id: string;
  payment_id: string; original_flight_id: string; current_flight_id: string | null;
  seat_id: string | null; label: string | null; fare_paid_paise: number;
  confirmed_at: Date; cancellation_reason: string | null;
  passenger_name: string | null; passenger_age: number | null;
};

async function readBooking(client: Pool | PoolClient, id: string, accountId: string): Promise<Booking | null> {
  const result = await client.query<BookingRow>(
    `SELECT b.*, s.label, p.passenger_name, p.passenger_age FROM bookings b
     JOIN payments p ON p.id = b.payment_id LEFT JOIN flight_seats s ON s.id = b.seat_id
     WHERE b.id = $1 AND b.account_id = $2`, [id, accountId],
  );
  const row = result.rows[0];
  if (!row) return null;
  const flights = await client.query<FlightRow>(`${flightSelect} WHERE f.id = ANY($1::uuid[])`,
    [[row.original_flight_id, row.current_flight_id].filter((id) => id !== null)]);
  const original = flights.rows.find((flight) => flight.id === row.original_flight_id);
  const current = flights.rows.find((flight) => flight.id === row.current_flight_id);
  if (!original) throw new Error('The original booking flight was not found.');
  return {
    id: row.id, reference: row.reference, status: row.status,
    originalFlight: flightData(original), currentFlight: current ? flightData(current) : null,
    seat: row.seat_id && row.label ? { id: row.seat_id, label: row.label } : null,
    farePaid: { amountMinor: row.fare_paid_paise, currency: 'INR' },
    paymentId: row.payment_id, confirmedAt: formatIst(row.confirmed_at), cancellationReason: row.cancellation_reason,
    passenger: row.passenger_name !== null && row.passenger_age !== null ? { name: row.passenger_name, age: row.passenger_age } : null,
  };
}

bookings.use((_request, response, next) => { response.set('Cache-Control', 'no-store'); next(); });

bookings.get('/', async (request, response) => {
  const user = await readPassenger(request, response);
  if (!user) return;
  const query = listQuery.parse(request.query);
  const page = Number(query.page ?? 1);
  const limit = Number(query.limit ?? 20);
  if (!Number.isSafeInteger(page) || page < 1 || !Number.isInteger(limit) || limit < 1 || limit > 100) {
    fail(response, 400, 'VALIDATION_ERROR', 'Use a positive whole page number and a limit from 1 to 100.'); return;
  }
  const count = await pool.query<{ total: number }>('SELECT count(*)::int AS total FROM bookings WHERE account_id = $1', [user.id]);
  const rows = await pool.query<{ id: string }>(
    'SELECT id FROM bookings WHERE account_id = $1 ORDER BY confirmed_at DESC, id LIMIT $2 OFFSET $3', [user.id, limit, (page - 1) * limit]);
  const data: Booking[] = [];
  for (const row of rows.rows) {
    const booking = await readBooking(pool, row.id, user.id);
    if (booking) data.push(booking);
  }
  response.json({ data, pagination: { page, limit, total: count.rows[0].total }, meta: meta() });
});

bookings.get('/:bookingId', async (request, response) => {
  const user = await readPassenger(request, response);
  if (!user) return;
  z.object({}).strict().parse(request.query);
  const { bookingId } = bookingPath.parse(request.params);
  const booking = await readBooking(pool, bookingId, user.id);
  if (!booking) { fail(response, 404, 'BOOKING_NOT_FOUND', 'Booking not found.'); return; }
  response.json({ data: booking, meta: meta() });
});

bookings.post('/:bookingId/cancel', async (request, response) => {
  const user = await readPassenger(request, response);
  if (!user) return;
  z.object({}).strict().parse(request.query);
  z.object({}).strict().parse(request.body);
  const { bookingId } = bookingPath.parse(request.params);
  const key = z.string().uuid().parse(request.get('Idempotency-Key'));
  const owned = await pool.query<BookingRow>('SELECT * FROM bookings WHERE id = $1 AND account_id = $2', [bookingId, user.id]);
  if (!owned.rows[0]) { fail(response, 404, 'BOOKING_NOT_FOUND', 'Booking not found.'); return; }
  const flightId = owned.rows[0].current_flight_id ?? owned.rows[0].original_flight_id;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const saved = await readOperation(client, user.id, 'CANCEL_BOOKING', key, { bookingId });
    if (!saved.matches) {
      await client.query('ROLLBACK'); fail(response, 409, 'IDEMPOTENCY_KEY_REUSED', 'Use a new key for a different booking.'); return;
    }
    if (saved.data && saved.http_status) {
      await client.query('COMMIT'); response.set('Idempotency-Replayed', 'true');
      response.status(saved.http_status).json({ data: saved.data, meta: meta() }); return;
    }
    const flights = await client.query<{ departure_at: Date }>('SELECT departure_at FROM flights WHERE id = $1 FOR UPDATE', [flightId]);
    const result = await client.query<BookingRow>('SELECT * FROM bookings WHERE id = $1 AND account_id = $2 FOR UPDATE', [bookingId, user.id]);
    const row = result.rows[0];
    const time = await client.query<{ checked_at: Date }>('SELECT clock_timestamp() AS checked_at');
    if (row.status === 'REBOOKING') {
      await client.query('ROLLBACK'); fail(response, 409, 'RECOVERY_IN_PROGRESS', 'Your booking is being rebooked. Please check it again shortly.'); return;
    }
    if (row.status === 'CONFIRMED' && flights.rows[0].departure_at <= time.rows[0].checked_at) {
      await client.query('ROLLBACK'); fail(response, 409, 'DEPARTURE_PASSED', 'This flight has already departed.'); return;
    }
    if (row.status !== 'CANCELLED') {
      await client.query('DELETE FROM seat_allocations WHERE booking_id = $1', [bookingId]);
      await client.query("UPDATE bookings SET status = 'CANCELLED', current_flight_id = NULL, seat_id = NULL, cancellation_reason = 'Cancelled by passenger.' WHERE id = $1", [bookingId]);
      await processFlightWaitlist(client, flightId);
    }
    const booking = await readBooking(client, bookingId, user.id);
    if (!booking) throw new Error('The cancelled booking was not found.');
    await saveOperation(client, user.id, 'CANCEL_BOOKING', key, 200, booking);
    await client.query('COMMIT');
    response.set('Idempotency-Replayed', 'false');
    response.json({ data: booking, meta: meta() });
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
});
