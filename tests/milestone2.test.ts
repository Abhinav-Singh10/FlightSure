import { beforeAll, afterAll, test, expect } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import type { Server } from 'node:http';
import type { Flight, Pagination, SeatMap, Session } from '../shared/types.ts';

const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl || new URL(testUrl).pathname !== '/flightsure_test') {
  throw new Error('Set TEST_DATABASE_URL to the separate flightsure_test database.');
}
// Set this before importing the app so its shared pool connects to the test DB.
process.env.DATABASE_URL = testUrl;
const { app } = await import('../server/app.ts');
const { pool } = await import('../server/db.ts');

const date = new Date(Date.now() + 330 * 60 * 1000 + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
const password = 'StudentPassword123!';
const createdEmails: string[] = [];
let server: Server | undefined;
let base = '';

beforeAll(async () => {
  // Reuse the real setup scripts rather than maintaining a second schema/seed.
  const env = { ...process.env, DATABASE_URL: testUrl, SEED_START_DATE: date };
  execFileSync('npm', ['run', 'db:migrate'], { env, stdio: 'pipe' });
  execFileSync('npm', ['run', 'db:seed'], { env, stdio: 'pipe' });
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server?.address();
  if (!address || typeof address === 'string') throw new Error('Test server did not start.');
  base = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  try {
    // Delete only passengers made by these tests; preserve seeds and other accounts.
    await pool.query('DELETE FROM sessions WHERE account_id IN (SELECT id FROM accounts WHERE email = ANY($1::text[]))', [createdEmails]);
    await pool.query('DELETE FROM accounts WHERE email = ANY($1::text[])', [createdEmails]);
  } finally {
    if (server) {
      const runningServer = server;
      await new Promise<void>((resolve) => runningServer.close(() => resolve()));
    }
    await pool.end();
  }
});

// fetch does not keep browser cookies in Node, so this small helper remembers them.
function browser() {
  const cookies = new Map<string, string>();

  async function request(path: string, options: RequestInit = {}) {
    const headers = new Headers(options.headers);
    headers.set('Cookie', [...cookies].map(([key, value]) => `${key}=${value}`).join('; '));
    if (options.body) headers.set('Content-Type', 'application/json');
    const response = await fetch(`${base}/api${path}`, { ...options, headers });
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(';')[0];
      const separator = pair.indexOf('=');
      cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
    }
    return response;
  }

  return { request };
}

function newEmail() {
  const email = `student-${randomUUID()}@example.com`;
  createdEmails.push(email);
  return email;
}

test('registration creates a passenger session and rejects duplicate normalized email', async () => {
  const student = browser();
  const email = newEmail();
  const response = await student.request('/auth/register', {
    method: 'POST', body: JSON.stringify({ email: ` ${email.toUpperCase()} `, password }),
  });
  expect(response.status).toBe(201);
  const body: { data: Session } = await response.json();
  expect(body.data.authenticated).toBe(true);
  expect(body.data.user?.role).toBe('PASSENGER');
  expect(body.data.user?.email).toBe(email);
  expect(body.data.user).not.toHaveProperty('password_hash');
  expect(response.headers.getSetCookie().some((cookie) => cookie.startsWith('access_token=') && cookie.includes('HttpOnly'))).toBe(true);

  const secondBrowser = browser();
  const duplicate = await secondBrowser.request('/auth/register', {
    method: 'POST', body: JSON.stringify({ email, password }),
  });
  expect(duplicate.status).toBe(409);
  expect((await duplicate.json()).error.code).toBe('EMAIL_ALREADY_REGISTERED');
  const count = await pool.query<{ count: number }>('SELECT count(*)::int AS count FROM accounts WHERE email = $1', [email]);
  expect(count.rows[0].count).toBe(1);
});

test('login, current session and logout work with generic invalid credentials', async () => {
  const student = browser();
  const email = newEmail();
  await student.request('/auth/register', { method: 'POST', body: JSON.stringify({ email, password }) });
  expect((await student.request('/auth/logout', { method: 'POST' })).status).toBe(204);
  expect((await (await student.request('/auth/session')).json()).data.authenticated).toBe(false);

  const invalid = await student.request('/auth/login', {
    method: 'POST', body: JSON.stringify({ email, password: 'WrongPassword' }),
  });
  expect(invalid.status).toBe(401);
  expect((await invalid.json()).error.code).toBe('INVALID_CREDENTIALS');
  const login = await student.request('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
  expect(login.status).toBe(200);
  const loggedIn: { data: Session } = await login.json();
  const current: { data: Session } = await (await student.request('/auth/session')).json();
  expect(current.data.user?.email).toBe(email);
  expect(current.data.expiresAt).toBe(loggedIn.data.expiresAt);
  expect((await student.request('/auth/logout', { method: 'POST' })).status).toBe(204);
  expect((await (await student.request('/auth/session')).json()).data.authenticated).toBe(false);
});

test('public flight search, details and seat map match the seeded data', async () => {
  const visitor = browser();
  const response = await visitor.request(`/flights?origin=DEL&destination=BLR&departureDate=${date}&limit=1`);
  expect(response.status).toBe(200);
  const body: { data: Flight[]; pagination: Pagination } = await response.json();
  expect(body.pagination.total).toBe(3);
  expect(body.data).toHaveLength(1);
  const flight = body.data[0];
  expect(flight.origin.name).toBe('Delhi');
  expect(flight.destination.code).toBe('BLR');
  expect(flight.departureAt).toBe(`${date}T09:00:00`);
  expect(flight.fare.amountMinor).toBe(450000);
  expect(flight.availableSeats).toBe(12);

  const details: { data: Flight } = await (await visitor.request(`/flights/${flight.id}`)).json();
  expect(details.data.id).toBe(flight.id);
  const cabin: { data: SeatMap } = await (await visitor.request(`/flights/${flight.id}/seats`)).json();
  expect(cabin.data.seats).toHaveLength(12);
  expect(cabin.data.layout.columns).toEqual(['A', 'B', 'C', 'D']);
  expect(cabin.data.seats.every((seat) => seat.status === 'AVAILABLE' && !seat.isMine)).toBe(true);
  expect((await visitor.request(`/flights?origin=DEL&destination=DEL&departureDate=${date}`)).status).toBe(400);
});
