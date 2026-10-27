import type { CookieOptions, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { pool } from './db.ts';
import { formatIst } from './time.ts';
import type { Session, User } from '../shared/types.ts';

const appOrigin = new URL(process.env.APP_ORIGIN ?? 'http://localhost:5173')
  .origin;
const jwtSecret = process.env.JWT_SECRET ?? '';

if (!jwtSecret) {
  throw new Error('Set JWT_SECRET in .env before starting the backend.');
}

const cookieOptions: CookieOptions = {
  httpOnly: true,
  secure: appOrigin.startsWith('https:'),
  sameSite: 'lax',
  path: '/',
};

export type SessionContext = {
  sessionId: string;
  user: User;
  expiresAt: Date;
};

type SessionRow = User & { session_id: string; expires_at: Date };

export async function readSession(
  request: Request,
): Promise<SessionContext | null> {
  const token: unknown = request.cookies.access_token;
  if (typeof token !== 'string') return null;

  let payload;
  try {
    // verify checks the signature and rejects expired tokens.
    payload = jwt.verify(token, jwtSecret, { algorithms: ['HS256'] });
  } catch {
    return null;
  }

  if (typeof payload === 'string') return null;
  if (typeof payload.sid !== 'string' || typeof payload.exp !== 'number')
    return null;
  const uuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuid.test(payload.sid)) return null;

  // The session row identifies the user and lets logout revoke their token.
  const result = await pool.query<SessionRow>(
    `SELECT a.id, a.email, a.role, s.id AS session_id, s.expires_at
     FROM sessions s JOIN accounts a ON a.id = s.account_id
     WHERE s.id = $1 AND s.revoked_at IS NULL AND s.expires_at > now()`,
    [payload.sid],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    sessionId: row.session_id,
    user: { id: row.id, email: row.email, role: row.role },
    expiresAt: row.expires_at,
  };
}

export function formatSession(context: SessionContext | null): Session {
  return {
    authenticated: context !== null,
    user: context?.user ?? null,
    expiresAt: context ? formatIst(context.expiresAt) : null,
  };
}

export function setLoginCookie(response: Response, context: SessionContext) {
  // This app only needs the session ID; its database row contains the account.
  const token = jwt.sign({ sid: context.sessionId }, jwtSecret, {
    algorithm: 'HS256',
    expiresIn: '15m',
  });
  response.cookie('access_token', token, {
    ...cookieOptions,
    maxAge: 15 * 60 * 1000,
  });
}

export function clearLoginCookie(response: Response) {
  response.clearCookie('access_token', cookieOptions);
}
