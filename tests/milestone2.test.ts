import { beforeAll, afterAll, test, expect } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import type { Server } from 'node:http';
import type {
  Flight,
  Booking,
  Payment,
  Hold,
  Pagination,
  SeatMap,
  Session,
} from '../shared/types.ts';

const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl || new URL(testUrl).pathname !== '/flightsure_test') {
  throw new Error(
    'Set TEST_DATABASE_URL to the separate flightsure_test database.',
  );
}
// Set this before importing the app so its shared pool connects to the test DB.
process.env.DATABASE_URL = testUrl;
const { app } = await import('../server/app.ts');
const { pool } = await import('../server/db.ts');

const date = new Date(Date.now() + 330 * 60 * 1000 + 24 * 60 * 60 * 1000)
  .toISOString()
  .slice(0, 10);
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
  if (!address || typeof address === 'string')
    throw new Error('Test server did not start.');
  base = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  try {
    // Delete only records belonging to these tests; preserve seeds and other accounts.
    await pool.query(
      'DELETE FROM seat_allocations WHERE account_id IN (SELECT id FROM accounts WHERE email = ANY($1::text[]))',
      [createdEmails],
    );
    await pool.query('DELETE FROM booking_assignments WHERE booking_id IN (SELECT id FROM bookings WHERE account_id IN (SELECT id FROM accounts WHERE email = ANY($1::text[])))', [createdEmails]);
    await pool.query('DELETE FROM bookings WHERE account_id IN (SELECT id FROM accounts WHERE email = ANY($1::text[]))', [createdEmails]);
    await pool.query('DELETE FROM payments WHERE hold_id IN (SELECT id FROM holds WHERE account_id IN (SELECT id FROM accounts WHERE email = ANY($1::text[])))', [createdEmails]);
    await pool.query(
      'DELETE FROM operations WHERE account_id IN (SELECT id FROM accounts WHERE email = ANY($1::text[]))',
      [createdEmails],
    );
    await pool.query(
      'DELETE FROM holds WHERE account_id IN (SELECT id FROM accounts WHERE email = ANY($1::text[]))',
      [createdEmails],
    );
    await pool.query(
      'DELETE FROM sessions WHERE account_id IN (SELECT id FROM accounts WHERE email = ANY($1::text[]))',
      [createdEmails],
    );
    await pool.query('DELETE FROM accounts WHERE email = ANY($1::text[])', [
      createdEmails,
    ]);
  } finally {
    if (server) {
      const runningServer = server;
      await new Promise<void>((resolve) =>
        runningServer.close(() => resolve()),
      );
    }
    await pool.end();
  }
});

// fetch does not keep browser cookies in Node, so this small helper remembers them.
function browser() {
  const cookies = new Map<string, string>();

  async function request(path: string, options: RequestInit = {}) {
    const headers = new Headers(options.headers);
    headers.set(
      'Cookie',
      [...cookies].map(([key, value]) => `${key}=${value}`).join('; '),
    );
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
    method: 'POST',
    body: JSON.stringify({ email: ` ${email.toUpperCase()} `, password }),
  });
  expect(response.status).toBe(201);
  const body: { data: Session } = await response.json();
  expect(body.data.authenticated).toBe(true);
  expect(body.data.user?.role).toBe('PASSENGER');
  expect(body.data.user?.email).toBe(email);
  expect(body.data.user).not.toHaveProperty('password_hash');
  expect(
    response.headers
      .getSetCookie()
      .some(
        (cookie) =>
          cookie.startsWith('access_token=') && cookie.includes('HttpOnly'),
      ),
  ).toBe(true);

  const secondBrowser = browser();
  const duplicate = await secondBrowser.request('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  expect(duplicate.status).toBe(409);
  expect((await duplicate.json()).error.code).toBe('EMAIL_ALREADY_REGISTERED');
  const count = await pool.query<{ count: number }>(
    'SELECT count(*)::int AS count FROM accounts WHERE email = $1',
    [email],
  );
  expect(count.rows[0].count).toBe(1);
});

test('login, current session and logout work with generic invalid credentials', async () => {
  const student = browser();
  const email = newEmail();
  await student.request('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  expect(
    (await student.request('/auth/logout', { method: 'POST' })).status,
  ).toBe(204);
  expect(
    (await (await student.request('/auth/session')).json()).data.authenticated,
  ).toBe(false);

  const invalid = await student.request('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password: 'WrongPassword' }),
  });
  expect(invalid.status).toBe(401);
  expect((await invalid.json()).error.code).toBe('INVALID_CREDENTIALS');
  const login = await student.request('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  expect(login.status).toBe(200);
  const loggedIn: { data: Session } = await login.json();
  const current: { data: Session } = await (
    await student.request('/auth/session')
  ).json();
  expect(current.data.user?.email).toBe(email);
  expect(current.data.expiresAt).toBe(loggedIn.data.expiresAt);
  expect(
    (await student.request('/auth/logout', { method: 'POST' })).status,
  ).toBe(204);
  expect(
    (await (await student.request('/auth/session')).json()).data.authenticated,
  ).toBe(false);
});

test('public flight search, details and seat map match the seeded data', async () => {
  const visitor = browser();
  const response = await visitor.request(
    `/flights?origin=DEL&destination=BLR&departureDate=${date}&limit=1`,
  );
  expect(response.status).toBe(200);
  const body: { data: Flight[]; pagination: Pagination } =
    await response.json();
  expect(body.pagination.total).toBe(3);
  expect(body.data).toHaveLength(1);
  const flight = body.data[0];
  expect(flight.origin.name).toBe('Delhi');
  expect(flight.destination.code).toBe('BLR');
  expect(flight.departureAt).toBe(`${date}T09:00:00`);
  expect(flight.fare.amountMinor).toBe(450000);
  expect(flight.availableSeats).toBe(80);

  const details: { data: Flight } = await (
    await visitor.request(`/flights/${flight.id}`)
  ).json();
  expect(details.data.id).toBe(flight.id);
  const cabin: { data: SeatMap } = await (
    await visitor.request(`/flights/${flight.id}/seats`)
  ).json();
  expect(cabin.data.seats).toHaveLength(80);
  expect(cabin.data.layout.columns).toEqual(['A', 'B', 'C', 'D']);
  expect(cabin.data.seats.at(-1)?.label).toBe('20D');
  expect(
    cabin.data.seats.every(
      (seat) => seat.status === 'AVAILABLE' && !seat.isMine,
    ),
  ).toBe(true);
  expect(
    (
      await visitor.request(
        `/flights?origin=DEL&destination=DEL&departureDate=${date}`,
      )
    ).status,
  ).toBe(400);
});

// Milestone three: two tests, bringing the whole project to five.
test('holds can be retried, read and released with consistent availability', async () => {
  const student = browser();
  await student.request('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email: newEmail(), password }),
  });
  const search = await student.request(
    `/flights?origin=BHO&destination=DEL&departureDate=${date}`,
  );
  const found: { data: Flight[] } = await search.json();
  const flight = found.data[0];
  const cabin: { data: SeatMap } = await (
    await student.request(`/flights/${flight.id}/seats`)
  ).json();
  const input = { flightId: flight.id, seatId: cabin.data.seats[0].id };
  const key = randomUUID();
  const created = await student.request('/holds', {
    method: 'POST',
    headers: { 'Idempotency-Key': key },
    body: JSON.stringify(input),
  });
  expect(created.status).toBe(201);
  expect(created.headers.get('Idempotency-Replayed')).toBe('false');
  const body: { data: Hold } = await created.json();
  expect(body.data.status).toBe('ACTIVE');
  expect(body.data.quote.amountMinor).toBe(450000);
  const replay = await student.request('/holds', {
    method: 'POST',
    headers: { 'Idempotency-Key': key },
    body: JSON.stringify(input),
  });
  expect(replay.headers.get('Idempotency-Replayed')).toBe('true');
  expect((await replay.json()).data.id).toBe(body.data.id);
  const changed = await student.request('/holds', {
    method: 'POST',
    headers: { 'Idempotency-Key': key },
    body: JSON.stringify({ ...input, seatId: cabin.data.seats[1].id }),
  });
  expect((await changed.json()).error.code).toBe('IDEMPOTENCY_KEY_REUSED');
  const current: { data: Hold } = await (
    await student.request(`/holds/${body.data.id}`)
  ).json();
  expect(current.data.expiresAt).toBe(body.data.expiresAt);
  const heldSeats: { data: SeatMap } = await (
    await student.request(`/flights/${flight.id}/seats`)
  ).json();
  expect(heldSeats.data.seats[0]).toMatchObject({
    status: 'HELD',
    isMine: true,
  });
  const reduced: { data: Flight } = await (
    await student.request(`/flights/${flight.id}`)
  ).json();
  expect(reduced.data.availableSeats).toBe(79);
  const released = await student.request(`/holds/${body.data.id}`, {
    method: 'DELETE',
    headers: { 'Idempotency-Key': randomUUID() },
  });
  expect((await released.json()).data.status).toBe('RELEASED');
  const restored: { data: Flight } = await (
    await student.request(`/flights/${flight.id}`)
  ).json();
  expect(restored.data.availableSeats).toBe(80);
});

test('competing passengers get one seat owner and expiry permits a new owner', async () => {
  const first = browser();
  const second = browser();
  await first.request('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email: newEmail(), password }),
  });
  await second.request('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email: newEmail(), password }),
  });
  const found: { data: Flight[] } = await (
    await first.request(
      `/flights?origin=BLR&destination=BHO&departureDate=${date}`,
    )
  ).json();
  const flight = found.data[0];
  const cabin: { data: SeatMap } = await (
    await first.request(`/flights/${flight.id}/seats`)
  ).json();
  const input = { flightId: flight.id, seatId: cabin.data.seats[0].id };
  const responses = await Promise.all(
    [first, second].map((student) =>
      student.request('/holds', {
        method: 'POST',
        headers: { 'Idempotency-Key': randomUUID() },
        body: JSON.stringify(input),
      }),
    ),
  );
  expect(responses.map((response) => response.status).sort()).toEqual([
    201, 409,
  ]);
  const winnerIndex = responses[0].status === 201 ? 0 : 1;
  const winner = winnerIndex === 0 ? first : second;
  const loser = winnerIndex === 0 ? second : first;
  const body: { data: Hold } = await responses[winnerIndex].json();
  expect((await responses[1 - winnerIndex].json()).error.code).toBe(
    'SEAT_UNAVAILABLE',
  );
  expect((await loser.request(`/holds/${body.data.id}`)).status).toBe(404);
  // Move fixture times into the past instead of sleeping for five minutes.
  await pool.query(
    "UPDATE holds SET created_at = clock_timestamp() - interval '6 minutes', expires_at = clock_timestamp() - interval '1 second' WHERE id = $1",
    [body.data.id],
  );
  expect(
    (await (await winner.request(`/holds/${body.data.id}`)).json()).data.status,
  ).toBe('EXPIRED');
  const beforeCleanup: { data: Flight } = await (
    await loser.request(`/flights/${flight.id}`)
  ).json();
  expect(beforeCleanup.data.availableSeats).toBe(80);
  const { processExpiredHolds } = await import('../server/allocations.ts');
  await processExpiredHolds();
  const replacement = await loser.request('/holds', {
    method: 'POST',
    headers: { 'Idempotency-Key': randomUUID() },
    body: JSON.stringify(input),
  });
  expect(replacement.status).toBe(201);
  await processExpiredHolds();
  const claim = await pool.query<{ hold_id: string }>(
    'SELECT hold_id FROM seat_allocations WHERE seat_id = $1',
    [input.seatId],
  );
  expect(claim.rows[0].hold_id).toBe((await replacement.json()).data.id);
});

async function registeredPassenger() {
  const student = browser();
  const response = await student.request('/auth/register', {
    method: 'POST', body: JSON.stringify({ email: newEmail(), password }),
  });
  expect(response.status).toBe(201);
  return student;
}

async function checkoutFixture(student: ReturnType<typeof browser>, origin: string, destination: string) {
  const found: { data: Flight[] } = await (await student.request(`/flights?origin=${origin}&destination=${destination}&departureDate=${date}`)).json();
  const flight = found.data[0];
  const cabin: { data: SeatMap } = await (await student.request(`/flights/${flight.id}/seats`)).json();
  const input = { flightId: flight.id, seatId: cabin.data.seats[0].id };
  const response = await student.request('/holds', {
    method: 'POST', headers: { 'Idempotency-Key': randomUUID() }, body: JSON.stringify(input),
  });
  expect(response.status).toBe(201);
  const body: { data: Hold } = await response.json();
  return { flight, input, hold: body.data };
}

test('successful payment is retry-safe, confirms one booking and supports cancellation', async () => {
  const student = await registeredPassenger();
  const { flight, hold } = await checkoutFixture(student, 'DEL', 'BHO');
  const key = randomUUID();
  const options = { method: 'POST', headers: { 'Idempotency-Key': key }, body: JSON.stringify({ outcome: 'SUCCESS', passengerName: 'Demo Passenger', passengerAge: 28 }) };
  const invalidPassenger = await student.request(`/holds/${hold.id}/payments`, { ...options, body: JSON.stringify({ outcome: 'SUCCESS', passengerName: 'Demo Passenger', passengerAge: 0 }) });
  expect(invalidPassenger.status).toBe(400);
  const responses = await Promise.all([
    student.request(`/holds/${hold.id}/payments`, options), student.request(`/holds/${hold.id}/payments`, options),
  ]);
  expect(responses.map((response) => response.status)).toEqual([202, 202]);
  expect(responses.map((response) => response.headers.get('Idempotency-Replayed')).sort()).toEqual(['false', 'true']);
  const first: { data: Payment } = await responses[0].json();
  expect((await responses[1].json()).data.id).toBe(first.data.id);
  const changed = await student.request(`/holds/${hold.id}/payments`, { ...options, body: JSON.stringify({ outcome: 'FAILURE' }) });
  expect((await changed.json()).error.code).toBe('IDEMPOTENCY_KEY_REUSED');
  const duplicate = await student.request(`/holds/${hold.id}/payments`, { ...options, headers: { 'Idempotency-Key': randomUUID() } });
  expect((await duplicate.json()).error.existingResourceId).toBe(first.data.id);
  const pending: { data: Hold } = await (await student.request(`/holds/${hold.id}`)).json();
  expect(pending.data).toMatchObject({ status: 'PAYMENT_PENDING', paymentId: first.data.id, expiresAt: hold.expiresAt });
  const { processWorkerPass } = await import('../server/worker.ts');
  await processWorkerPass();
  await processWorkerPass();
  const payment: { data: Payment } = await (await student.request(`/payments/${first.data.id}`)).json();
  expect(payment.data.status).toBe('SUCCEEDED');
  const originalResult = await student.request(`/holds/${hold.id}/payments`, options);
  expect((await originalResult.json()).data).toMatchObject({ id: first.data.id, status: 'PENDING' });
  const confirmed: { data: Booking } = await (await student.request(`/bookings/${payment.data.bookingId}`)).json();
  expect(confirmed.data.reference).toMatch(/^FS[A-Z0-9]{8}$/);
  expect(confirmed.data).toMatchObject({ status: 'CONFIRMED', farePaid: hold.quote, seat: hold.seat, paymentId: first.data.id, passenger: { name: 'Demo Passenger', age: 28 } });
  const consumed: { data: Hold } = await (await student.request(`/holds/${hold.id}`)).json();
  expect(consumed.data).toMatchObject({ status: 'CONSUMED', bookingId: confirmed.data.id });
  const cabin: { data: SeatMap } = await (await student.request(`/flights/${flight.id}/seats`)).json();
  expect(cabin.data.seats[0]).toMatchObject({ status: 'BOOKED', isMine: true });
  const occupied: { data: Flight } = await (await student.request(`/flights/${flight.id}`)).json();
  expect(occupied.data.availableSeats).toBe(79);
  const history = await (await student.request('/bookings?limit=1')).json();
  expect(history.pagination).toMatchObject({ total: 1, page: 1, limit: 1 });
  const other = await registeredPassenger();
  expect((await other.request(`/payments/${first.data.id}`)).status).toBe(404);
  expect((await other.request(`/bookings/${confirmed.data.id}`)).status).toBe(404);
  const cancelOptions = { method: 'POST', headers: { 'Idempotency-Key': randomUUID() }, body: '{}' };
  const cancelled: { data: Booking } = await (await student.request(`/bookings/${confirmed.data.id}/cancel`, cancelOptions)).json();
  expect(cancelled.data).toMatchObject({ status: 'CANCELLED', currentFlight: null, seat: null, reference: confirmed.data.reference, cancellationReason: 'Cancelled by passenger.', passenger: confirmed.data.passenger });
  const replay = await student.request(`/bookings/${confirmed.data.id}/cancel`, cancelOptions);
  expect(replay.headers.get('Idempotency-Replayed')).toBe('true');
  expect((await student.request(`/bookings/${confirmed.data.id}/cancel`, { ...cancelOptions, headers: { 'Idempotency-Key': randomUUID() } })).status).toBe(200);
  const restored: { data: Flight } = await (await student.request(`/flights/${flight.id}`)).json();
  expect(restored.data.availableSeats).toBe(80);
  expect((await (await student.request(`/payments/${first.data.id}`)).json()).data.status).toBe('SUCCEEDED');
  const count = await pool.query<{ count: number }>('SELECT count(*)::int AS count FROM bookings WHERE payment_id = $1', [first.data.id]);
  expect(count.rows[0].count).toBe(1);
  const assignments = await pool.query<{ seat_id: string }>('SELECT seat_id FROM booking_assignments WHERE booking_id = $1 AND flight_id = $2', [confirmed.data.id, flight.id]);
  expect(assignments.rows).toEqual([{ seat_id: hold.seat.id }]);
});

test('simulated failure releases the hold and a new attempt requires a new hold', async () => {
  const student = await registeredPassenger();
  const { hold, flight, input } = await checkoutFixture(student, 'BHO', 'BLR');
  const options = { method: 'POST', headers: { 'Idempotency-Key': randomUUID() }, body: JSON.stringify({ outcome: 'FAILURE' }) };
  const started: { data: Payment } = await (await student.request(`/holds/${hold.id}/payments`, options)).json();
  const { processWorkerPass } = await import('../server/worker.ts');
  await processWorkerPass();
  const failed: { data: Payment } = await (await student.request(`/payments/${started.data.id}`)).json();
  expect(failed.data).toMatchObject({ status: 'FAILED', bookingId: null, reason: 'Simulated payment failure.' });
  expect(failed.data.completedAt).not.toBeNull();
  expect((await (await student.request(`/holds/${hold.id}`)).json()).data.status).toBe('FAILED');
  expect((await (await student.request('/bookings')).json()).data).toEqual([]);
  const detail: { data: Flight } = await (await student.request(`/flights/${flight.id}`)).json();
  expect(detail.data.availableSeats).toBe(80);
  const blocked = await student.request(`/holds/${hold.id}/payments`, { ...options, headers: { 'Idempotency-Key': randomUUID() } });
  expect((await blocked.json()).error.code).toBe('PAYMENT_ALREADY_STARTED');
  const replacement = await student.request('/holds', { method: 'POST', headers: { 'Idempotency-Key': randomUUID() }, body: JSON.stringify(input) });
  expect(replacement.status).toBe(201);
});

test('a restarted worker voids late success without removing the replacement seat claim', async () => {
  const student = await registeredPassenger();
  const other = await registeredPassenger();
  const { hold, input } = await checkoutFixture(student, 'BLR', 'DEL');
  const started: { data: Payment } = await (await student.request(`/holds/${hold.id}/payments`, {
    method: 'POST', headers: { 'Idempotency-Key': randomUUID() }, body: JSON.stringify({ outcome: 'DELAYED_SUCCESS' }),
  })).json();
  await pool.query("UPDATE holds SET created_at = clock_timestamp() - interval '6 minutes', expires_at = clock_timestamp() - interval '1 second' WHERE id = $1", [hold.id]);
  await pool.query("UPDATE payments SET created_at = clock_timestamp() - interval '2 minutes', due_at = clock_timestamp() - interval '1 second' WHERE id = $1", [started.data.id]);
  const replacement = await other.request('/holds', { method: 'POST', headers: { 'Idempotency-Key': randomUUID() }, body: JSON.stringify(input) });
  expect(replacement.status).toBe(201);
  const next: { data: Hold } = await replacement.json();
  // A separate process has no previous timers or payment state to rely on.
  execFileSync(process.execPath, ['--env-file=.env', '--input-type=module', '-e',
    "const {processWorkerPass}=await import('./server/worker.ts'); await processWorkerPass(); const {pool}=await import('./server/db.ts'); await pool.end();"],
    { env: { ...process.env, DATABASE_URL: testUrl }, stdio: 'pipe' });
  const payment: { data: Payment } = await (await student.request(`/payments/${started.data.id}`)).json();
  expect(payment.data).toMatchObject({ status: 'VOIDED', bookingId: null });
  expect(payment.data.reason).toBeTruthy();
  expect((await (await student.request(`/holds/${hold.id}`)).json()).data.status).toBe('EXPIRED');
  const claim = await pool.query<{ hold_id: string }>('SELECT hold_id FROM seat_allocations WHERE seat_id = $1', [input.seatId]);
  expect(claim.rows[0].hold_id).toBe(next.data.id);
  expect((await (await student.request('/bookings')).json()).data).toEqual([]);
});
