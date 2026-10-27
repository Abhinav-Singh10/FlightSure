import { Router } from 'express';
import type { PoolClient } from 'pg';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import { pool } from './db.ts';
import { fail, meta } from './http.ts';
import {
  clearLoginCookie,
  readSession,
  formatSession,
  setLoginCookie,
} from './session.ts';
import type { SessionContext } from './session.ts';
import type { User } from '../shared/types.ts';

export const auth = Router();

const email = z.string().trim().toLowerCase().email().max(254);
const registerBody = z
  .object({ email, password: z.string().min(8).max(72) })
  .strict();
const loginBody = z
  .object({ email, password: z.string().min(8).max(72) })
  .strict();

auth.use((request, response, next) => {
  response.set('Cache-Control', 'no-store');
  z.object({}).strict().parse(request.query);
  next();
});

async function createSession(
  client: PoolClient,
  user: User,
): Promise<SessionContext> {
  const result = await client.query<{ id: string; expires_at: Date }>(
    "INSERT INTO sessions (account_id, expires_at) VALUES ($1, now() + interval '15 minutes') RETURNING id, expires_at",
    [user.id],
  );
  const row = result.rows[0];
  return { sessionId: row.id, expiresAt: row.expires_at, user };
}

auth.get('/session', async (request, response) => {
  const context = await readSession(request);
  if (!context) clearLoginCookie(response);
  response.json({ data: formatSession(context), meta: meta() });
});

auth.post('/register', async (request, response) => {
  const current = await readSession(request);
  if (current) {
    fail(response, 409, 'ALREADY_AUTHENTICATED', 'You are already logged in.');
    return;
  }
  const input = registerBody.parse(request.body);
  // bcrypt limits bytes, so non-ASCII passwords also need this check.
  if (Buffer.byteLength(input.password, 'utf8') > 72) {
    fail(
      response,
      400,
      'VALIDATION_ERROR',
      'Password must be at most 72 UTF-8 bytes.',
      [{ field: 'password', message: 'Use a shorter password.' }],
    );
    return;
  }
  const passwordHash = await bcrypt.hash(input.password, 12);
  const client = await pool.connect();
  let context: SessionContext;
  try {
    // Create both records together so a failed signup leaves no partial account.
    await client.query('BEGIN');
    const result = await client.query<User>(
      "INSERT INTO accounts (email, password_hash, role) VALUES ($1, $2, 'PASSENGER') RETURNING id, email, role",
      [input.email, passwordHash],
    );
    context = await createSession(client, result.rows[0]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    if (error instanceof Error && 'code' in error && error.code === '23505') {
      fail(
        response,
        409,
        'EMAIL_ALREADY_REGISTERED',
        'This email is already registered. Please log in.',
      );
      return;
    }
    throw error;
  } finally {
    client.release();
  }
  setLoginCookie(response, context);
  response.status(201).json({ data: formatSession(context), meta: meta() });
});

auth.post('/login', async (request, response) => {
  const current = await readSession(request);
  const input = loginBody.parse(request.body);
  if (Buffer.byteLength(input.password, 'utf8') > 72) {
    fail(
      response,
      400,
      'VALIDATION_ERROR',
      'Password must be at most 72 UTF-8 bytes.',
    );
    return;
  }
  const result = await pool.query<User & { password_hash: string }>(
    'SELECT id, email, role, password_hash FROM accounts WHERE email = $1',
    [input.email],
  );
  const account = result.rows[0];
  if (
    !account ||
    !(await bcrypt.compare(input.password, account.password_hash))
  ) {
    fail(response, 401, 'INVALID_CREDENTIALS', 'Incorrect email or password.');
    return;
  }
  const user: User = {
    id: account.id,
    email: account.email,
    role: account.role,
  };
  const client = await pool.connect();
  let context: SessionContext;
  try {
    await client.query('BEGIN');
    if (current) {
      await client.query(
        'UPDATE sessions SET revoked_at = now() WHERE id = $1',
        [current.sessionId],
      );
    }
    context = await createSession(client, user);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  setLoginCookie(response, context);
  response.json({ data: formatSession(context), meta: meta() });
});

auth.post('/logout', async (request, response) => {
  const current = await readSession(request);
  z.object({}).strict().optional().parse(request.body);
  if (current) {
    await pool.query('UPDATE sessions SET revoked_at = now() WHERE id = $1', [
      current.sessionId,
    ]);
  }
  clearLoginCookie(response);
  response.status(204).end();
});
