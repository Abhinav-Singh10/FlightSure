import { Router } from 'express';
import type { Request, Response } from 'express';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import { pool } from './db.ts';
import { readPassenger } from './session.ts';
import { fail, meta } from './http.ts';
import { formatIst } from './time.ts';
import { readHold } from './holds.ts';
import { processFlightWaitlist } from './allocations.ts';
import { readOperation, saveOperation } from './operations.ts';
import type { Notification, OfferAcceptance, WaitlistEntry } from '../shared/types.ts';

export const waitlist = Router();
const entryPath = z.object({ entryId: z.string().uuid() }).strict();
const flightPath = z.object({ flightId: z.string().uuid() }).strict();
const listQuery = z.object({ page: z.coerce.number().int().min(1).max(Number.MAX_SAFE_INTEGER).default(1), limit: z.coerce.number().int().min(1).max(100).default(20) }).strict();

type EntryRow = {
  id: string; flight_id: string; account_id: string; status: WaitlistEntry['status'];
  joined_at: Date; offer_hold_id: string | null; accepted_at: Date | null; booking_id: string | null;
};

export async function readWaitlistEntry(client: Pool | PoolClient, id: string, accountId: string): Promise<WaitlistEntry | null> {
  const result = await client.query<EntryRow>(`SELECT w.id, w.flight_id, w.account_id, w.joined_at, w.offer_hold_id, w.accepted_at, w.booking_id,
    CASE WHEN w.status = 'OFFERED' AND (h.status = 'EXPIRED' OR (h.status IN ('ACTIVE', 'PAYMENT_PENDING') AND h.expires_at <= clock_timestamp())) THEN 'EXPIRED'
      WHEN w.status IN ('WAITING', 'OFFERED') AND (f.status <> 'SCHEDULED' OR f.departure_at <= clock_timestamp()) THEN 'CLOSED'
      ELSE w.status END AS status
    FROM waitlist_entries w JOIN flights f ON f.id = w.flight_id LEFT JOIN holds h ON h.id = w.offer_hold_id
    WHERE w.id = $1 AND w.account_id = $2`, [id, accountId]);
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: row.id, flightId: row.flight_id, status: row.status, joinedAt: formatIst(row.joined_at),
    offerHold: row.offer_hold_id ? await readHold(client, row.offer_hold_id, accountId) : null,
    acceptedAt: row.accepted_at ? formatIst(row.accepted_at) : null, bookingId: row.booking_id,
  };
}

waitlist.get('/waitlist', async (request, response) => {
  response.set('Cache-Control', 'no-store');
  const user = await readPassenger(request, response);
  if (!user) return;
  const { page, limit } = listQuery.parse(request.query);
  const count = await pool.query<{ total: number }>('SELECT count(*)::int AS total FROM waitlist_entries WHERE account_id = $1', [user.id]);
  const rows = await pool.query<{ id: string }>('SELECT id FROM waitlist_entries WHERE account_id = $1 ORDER BY joined_at DESC, id LIMIT $2 OFFSET $3', [user.id, limit, (page - 1) * limit]);
  const data: WaitlistEntry[] = [];
  for (const row of rows.rows) {
    const entry = await readWaitlistEntry(pool, row.id, user.id);
    if (entry) data.push(entry);
  }
  response.json({ data, pagination: { page, limit, total: count.rows[0].total }, meta: meta() });
});

waitlist.get('/waitlist/:entryId', async (request, response) => {
  response.set('Cache-Control', 'no-store');
  const user = await readPassenger(request, response);
  if (!user) return;
  z.object({}).strict().parse(request.query);
  const { entryId } = entryPath.parse(request.params);
  const entry = await readWaitlistEntry(pool, entryId, user.id);
  if (!entry) { fail(response, 404, 'WAITLIST_NOT_FOUND', 'Waitlist entry not found.'); return; }
  response.json({ data: entry, meta: meta() });
});

waitlist.get('/notifications', async (request, response) => {
  response.set('Cache-Control', 'no-store');
  const user = await readPassenger(request, response);
  if (!user) return;
  const { page, limit } = listQuery.parse(request.query);
  const count = await pool.query<{ total: number }>('SELECT count(*)::int AS total FROM notifications WHERE account_id = $1', [user.id]);
  const result = await pool.query<{ id: string; type: Notification['type']; message: string; flight_id: string; booking_id: string | null; waitlist_entry_id: string | null; created_at: Date }>(
    'SELECT * FROM notifications WHERE account_id = $1 ORDER BY created_at DESC, id LIMIT $2 OFFSET $3', [user.id, limit, (page - 1) * limit]);
  const data: Notification[] = result.rows.map((row) => ({ id: row.id, type: row.type, message: row.message, flightId: row.flight_id,
    bookingId: row.booking_id, waitlistEntryId: row.waitlist_entry_id, createdAt: formatIst(row.created_at) }));
  response.json({ data, pagination: { page, limit, total: count.rows[0].total }, meta: meta() });
});

async function changeWaitlist(request: Request, response: Response) {
  response.set('Cache-Control', 'no-store');
  const user = await readPassenger(request, response);
  if (!user) return;
  z.object({}).strict().parse(request.query);
  const joining = request.params.flightId !== undefined;
  const accepting = !joining && request.method === 'POST';
  if (request.method === 'DELETE') z.object({}).strict().optional().parse(request.body);
  else z.object({}).strict().parse(request.body);
  const key = z.string().uuid().parse(request.get('Idempotency-Key'));
  let entryId = '';
  let flightId = '';
  if (joining) flightId = flightPath.parse(request.params).flightId;
  else {
    entryId = entryPath.parse(request.params).entryId;
    const owned = await pool.query<{ flight_id: string }>('SELECT flight_id FROM waitlist_entries WHERE id = $1 AND account_id = $2', [entryId, user.id]);
    if (!owned.rows[0]) { fail(response, 404, 'WAITLIST_NOT_FOUND', 'Waitlist entry not found.'); return; }
    flightId = owned.rows[0].flight_id;
  }
  const operation = joining ? 'JOIN_WAITLIST' : accepting ? 'ACCEPT_OFFER' : 'WITHDRAW_WAITLIST';
  const payload = joining ? { flightId } : { entryId };
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const saved = await readOperation(client, user.id, operation, key, payload);
    if (!saved.matches) { await client.query('ROLLBACK'); fail(response, 409, 'IDEMPOTENCY_KEY_REUSED', 'Use a new key for a different waitlist request.'); return; }
    if (saved.data && saved.http_status) {
      await client.query('COMMIT'); response.set('Idempotency-Replayed', 'true');
      response.status(saved.http_status).json({ data: saved.data, meta: meta() }); return;
    }
    const flights = await client.query<{ status: string; departure_at: Date }>('SELECT status, departure_at FROM flights WHERE id = $1 FOR UPDATE', [flightId]);
    if (!flights.rows[0]) { await client.query('ROLLBACK'); fail(response, 404, 'FLIGHT_NOT_FOUND', 'Flight not found.'); return; }
    await processFlightWaitlist(client, flightId);
    if (!joining) await client.query('SELECT id FROM waitlist_entries WHERE id = $1 FOR UPDATE', [entryId]);
    const time = await client.query<{ checked_at: Date }>('SELECT clock_timestamp() AS checked_at');
    const checkedAt = time.rows[0].checked_at;
    const flight = flights.rows[0];
    let code = '';
    let message = '';
    let existingId: string | null = null;
    let data: WaitlistEntry | OfferAcceptance | null = null;
    if (joining) {
      const claim = await client.query<{ hold_id: string | null; booking_id: string | null }>('SELECT hold_id, booking_id FROM seat_allocations WHERE flight_id = $1 AND account_id = $2', [flightId, user.id]);
      const existing = await client.query<{ id: string }>("SELECT id FROM waitlist_entries WHERE flight_id = $1 AND account_id = $2 AND status IN ('WAITING', 'OFFERED')", [flightId, user.id]);
      const free = await client.query('SELECT s.id FROM flight_seats s WHERE s.flight_id = $1 AND NOT EXISTS (SELECT 1 FROM seat_allocations a WHERE a.seat_id = s.id) LIMIT 1', [flightId]);
      if (flight.status !== 'SCHEDULED' || flight.departure_at <= checkedAt) { code = 'FLIGHT_NOT_BOOKABLE'; message = 'This flight is no longer bookable.'; }
      else if (existing.rows[0]) { code = 'WAITLIST_ENTRY_EXISTS'; message = 'You already have an active waitlist entry.'; existingId = existing.rows[0].id; }
      else if (claim.rows[0]?.booking_id) { code = 'ALREADY_BOOKED'; message = 'You already booked this flight.'; existingId = claim.rows[0].booking_id; }
      else if (claim.rows[0]?.hold_id) { code = 'ACTIVE_HOLD_EXISTS'; message = 'You already hold a seat on this flight.'; existingId = claim.rows[0].hold_id; }
      else if (free.rowCount) { code = 'SEATS_AVAILABLE'; message = 'Seats are available. Choose one in the cabin.'; }
      else {
        const inserted = await client.query<{ id: string }>('INSERT INTO waitlist_entries (account_id, flight_id, joined_at) VALUES ($1, $2, $3) RETURNING id', [user.id, flightId, checkedAt]);
        entryId = inserted.rows[0].id;
        data = await readWaitlistEntry(client, entryId, user.id);
      }
    } else {
      const entry = await readWaitlistEntry(client, entryId, user.id);
      if (!entry) throw new Error('The owned waitlist entry disappeared.');
      const hold = entry.offerHold;
      if (accepting) {
        if (entry.status === 'EXPIRED') { code = 'OFFER_EXPIRED'; message = 'This offer has expired.'; }
        else if (flight.status !== 'SCHEDULED' || flight.departure_at <= checkedAt) { code = 'FLIGHT_NOT_BOOKABLE'; message = 'This flight is no longer bookable.'; }
        else if (entry.status !== 'OFFERED' || !hold || hold.status !== 'ACTIVE') { code = 'OFFER_NOT_AVAILABLE'; message = 'There is no active offer to accept.'; }
        else {
          await client.query('UPDATE waitlist_entries SET accepted_at = COALESCE(accepted_at, $2) WHERE id = $1', [entryId, checkedAt]);
          const accepted = await readWaitlistEntry(client, entryId, user.id);
          if (!accepted || !accepted.offerHold) throw new Error('The accepted offer was not found.');
          data = { waitlistEntry: accepted, hold: accepted.offerHold };
        }
      } else {
        if (entry.status === 'FULFILLED') { code = 'USE_BOOKING_CANCELLATION'; message = 'Cancel the booking instead.'; existingId = entry.bookingId; }
        else if (hold?.status === 'PAYMENT_PENDING') { code = 'PAYMENT_IN_PROGRESS'; message = 'Payment is already in progress.'; }
        else {
          if (entry.status === 'WAITING' || entry.status === 'OFFERED') {
            if (hold) {
              await client.query('DELETE FROM seat_allocations WHERE hold_id = $1', [hold.id]);
              await client.query("UPDATE holds SET status = 'RELEASED' WHERE id = $1 AND status = 'ACTIVE'", [hold.id]);
            }
            await client.query("UPDATE waitlist_entries SET status = 'WITHDRAWN' WHERE id = $1", [entryId]);
          }
          await processFlightWaitlist(client, flightId);
          data = await readWaitlistEntry(client, entryId, user.id);
        }
      }
    }
    if (code) { await client.query('ROLLBACK'); fail(response, 409, code, message, [], existingId); return; }
    if (!data) throw new Error('The waitlist operation was not saved.');
    const status = joining ? 201 : 200;
    await saveOperation(client, user.id, operation, key, status, data);
    await client.query('COMMIT');
    response.set('Idempotency-Replayed', 'false'); response.status(status).json({ data, meta: meta() });
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

waitlist.post('/flights/:flightId/waitlist', changeWaitlist);
waitlist.post('/waitlist/:entryId/accept', changeWaitlist);
waitlist.delete('/waitlist/:entryId', changeWaitlist);
