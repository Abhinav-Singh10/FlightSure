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
