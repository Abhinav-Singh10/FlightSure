import type { PoolClient } from 'pg';
import type { Hold, Payment, Booking, WaitlistEntry, OfferAcceptance, CancellationTask } from '../shared/types.ts';

type OperationData = Hold | Payment | Booking | WaitlistEntry | OfferAcceptance | CancellationTask;

type SavedOperation = { matches: boolean; http_status: number | null; data: OperationData | null };

// Reserve the request key before taking a flight lock. Concurrent retries wait
// here, then read the first request's committed result instead of running twice.
export async function readOperation(
  client: PoolClient, accountId: string, operation: string, key: string, payload: object,
) {
  const values = [accountId, operation, key, JSON.stringify(payload)];
  await client.query(
    `INSERT INTO operations (account_id, operation, idempotency_key, payload)
     VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`, values,
  );
  const result = await client.query<SavedOperation>(
    `SELECT payload = $4::jsonb AS matches, http_status, data FROM operations
     WHERE account_id = $1 AND operation = $2 AND idempotency_key = $3 FOR UPDATE`, values,
  );
  return result.rows[0];
}

export async function saveOperation(
  client: PoolClient, accountId: string, operation: string, key: string, status: number, data: OperationData,
) {
  await client.query(
    `UPDATE operations SET http_status = $4, data = $5
     WHERE account_id = $1 AND operation = $2 AND idempotency_key = $3`,
    [accountId, operation, key, status, JSON.stringify(data)],
  );
}
