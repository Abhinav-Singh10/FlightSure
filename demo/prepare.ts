import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { app } from '../server/app.ts';
import { pool } from '../server/db.ts';
import { processDuePayments } from '../server/payments.ts';
import type { Hold, Payment, Session } from '../shared/types.ts';

type Passenger = { id: string; email: string; cookie: string; name: string };
type Seat = { id: string; label: string };
const password = 'FlightSureDemo123!'; // Public, disposable demonstration accounts only.
const run = randomUUID().slice(0, 8);
const day = 24 * 60 * 60 * 1000;
const paymentIds: string[] = [];
const server = app.listen(0, '127.0.0.1');

function calendarDate(date: Date) {
  return new Date(date.getTime() + 330 * 60 * 1000).toISOString().slice(0, 10);
}

function nextDate(date: string) {
  return new Date(new Date(`${date}T00:00:00Z`).getTime() + day).toISOString().slice(0, 10);
}

async function request(path: string, cookie: string, body: object) {
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('The demo API did not start.');
  const response = await fetch(`http://127.0.0.1:${address.port}/api${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie, 'Idempotency-Key': randomUUID() },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const result: { error?: { message?: string } } = await response.json();
    throw new Error(`${path}: ${result.error?.message ?? response.status}`);
  }
  return response;
}

async function register(label: string, name: string): Promise<Passenger> {
  const email = `demo-${run}-${label}@example.com`;
  const response = await request('/auth/register', '', { email, password });
  const result: { data: Session } = await response.json();
  if (!result.data.user) throw new Error('Registration did not return a passenger.');
  const cookie = response.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ');
  return { id: result.data.user.id, email, cookie, name };
}

async function createFlight(number: string, origin: string, destination: string, date: string, hour: number, fare: number, layoutId: string) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const departure = `${date}T${String(hour).padStart(2, '0')}:00:00+05:30`;
    const result = await client.query<{ id: string }>(
      `INSERT INTO flights (flight_number, origin, destination, departure_at, arrival_at, fare_paise, layout_id)
       VALUES ($1, $2, $3, $4, $4::timestamptz + interval '2 hours', $5, $6) RETURNING id`,
      [number, origin, destination, departure, fare, layoutId],
    );
    const id = result.rows[0].id;
    await client.query(
      `INSERT INTO flight_seats (flight_id, label, row_number, column_letter)
       SELECT $1, r::text || c, r, c FROM generate_series(1, 20) r
       CROSS JOIN unnest(ARRAY['A', 'B', 'C', 'D']) c`, [id],
    );
    const seats = await client.query<Seat>('SELECT id, label FROM flight_seats WHERE flight_id = $1 ORDER BY row_number, column_letter', [id]);
    await client.query('COMMIT');
    return { id, number, origin, destination, date, hour, seats: seats.rows };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function book(passenger: Passenger, flightId: string, seat: Seat) {
  const held: { data: Hold } = await (await request('/holds', passenger.cookie, { flightId, seatId: seat.id })).json();
  const payment: { data: Payment } = await (await request(`/holds/${held.data.id}/payments`, passenger.cookie, {
    outcome: 'SUCCESS', passengerName: passenger.name, passengerAge: 25,
  })).json();
  paymentIds.push(payment.data.id);
  return payment.data.id;
}

async function finishPayments() {
  // Use the real payment worker, in small batches, instead of fabricating bookings.
  for (let pass = 0; pass < 10; pass += 1) {
    const pending = await pool.query("SELECT id FROM payments WHERE id = ANY($1::uuid[]) AND status = 'PENDING'", [paymentIds]);
    if (!pending.rowCount) break;
    await processDuePayments(paymentIds);
  }
  const failed = await pool.query("SELECT id FROM payments WHERE id = ANY($1::uuid[]) AND status <> 'SUCCEEDED'", [paymentIds]);
  if (failed.rowCount) throw new Error('Some demo payments have not succeeded. Check the database and worker logs, then prepare a fresh run.');
}

async function prepare() {
  if (!server.listening) await new Promise<void>((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const layout = await pool.query<{ id: string }>(
    "SELECT id FROM aircraft_layouts WHERE name = 'FlightSure 2-2 cabin' AND row_count = 20 AND columns = ARRAY['A','B','C','D'] AND aisle_after = ARRAY['B']",
  );
  const admin = await pool.query("SELECT id FROM accounts WHERE role = 'ADMIN' LIMIT 1");
  if (!layout.rows[0] || !admin.rowCount) throw new Error('Run db:migrate and db:seed before preparing the demo.');

  const latest = await pool.query<{ departure_at: Date | null }>('SELECT max(departure_at) AS departure_at FROM flights');
  const tomorrow = nextDate(calendarDate(new Date()));
  const afterExisting = latest.rows[0].departure_at ? nextDate(calendarDate(latest.rows[0].departure_at)) : tomorrow;
  const earliest = tomorrow > afterExisting ? tomorrow : afterExisting;
  const date = process.env.DEMO_DATE ?? earliest;
  const parsed = new Date(`${date}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date || date < earliest) {
    throw new Error(`DEMO_DATE must be a valid YYYY-MM-DD on or after ${earliest}. Later dates keep recovery isolated from existing flights.`);
  }
  console.log(`Preparing demo ${run}, starting ${date} IST. Existing records will remain unchanged.`);
  const prefix = `D${run.slice(0, 4).toUpperCase()}`;
  const normal = await createFlight(`${prefix}N`, 'DEL', 'BLR', date, 9, 450000, layout.rows[0].id);
  const full = await createFlight(`${prefix}W`, 'DEL', 'BHO', date, 13, 450000, layout.rows[0].id);
  const recoveryDate = nextDate(date);
  const source = await createFlight(`${prefix}C`, 'BHO', 'DEL', recoveryDate, 9, 450023, layout.rows[0].id);
  const replacement = await createFlight(`${prefix}R`, 'BHO', 'DEL', recoveryDate, 13, 600001, layout.rows[0].id);

  const a = await register('a', 'Presenter A');
  const b = await register('b', 'Presenter B');
  const waitlistPayment = await book(a, full.id, full.seats[0]);
  const firstPayment = await book(a, source.id, source.seats[0]);
  await finishPayments(); // A is confirmed first, so A gets the single replacement.
  const secondPayment = await book(b, source.id, source.seats[1]);
  for (let index = 1; index <= 79; index += 1) {
    const filler = await register(`filler-${index}`, `Demo Passenger ${index}`);
    await book(filler, full.id, full.seats[index]);
    await book(filler, replacement.id, replacement.seats[index]);
    await request('/auth/logout', filler.cookie, {});
    if (index % 10 === 0) {
      await finishPayments();
      console.log(`Registered and booked ${index}/79 background passengers.`);
    }
  }
  await finishPayments();
  await request('/auth/logout', a.cookie, {});
  await request('/auth/logout', b.cookie, {});

  const counts = await pool.query<{ flight_id: string; total: number }>(
    'SELECT flight_id, count(*)::int AS total FROM seat_allocations WHERE flight_id = ANY($1::uuid[]) GROUP BY flight_id',
    [[normal.id, full.id, source.id, replacement.id]],
  );
  for (const [id, expected] of [[normal.id, 0], [full.id, 80], [source.id, 2], [replacement.id, 79]]) {
    if ((counts.rows.find((row) => row.flight_id === id)?.total ?? 0) !== expected) throw new Error('Demo seat counts changed during preparation. Prepare a fresh run.');
  }
  const bookings = await pool.query<{ id: string; payment_id: string; reference: string }>(
    'SELECT id, payment_id, reference FROM bookings WHERE payment_id = ANY($1::uuid[])',
    [[waitlistPayment, firstPayment, secondPayment]],
  );
  function bookingLink(paymentId: string) {
    const booking = bookings.rows.find((row) => row.payment_id === paymentId);
    if (!booking) throw new Error('A presenter booking was not confirmed.');
    return `[${booking.reference}](${origin}/?view=booking&booking=${booking.id})`;
  }
  const origin = process.env.APP_ORIGIN ?? 'http://localhost:5173';
  const markdown = `# Current FlightSure demo\n\nRun: ${run}. All times are IST. Follow [the presentation guide](presentation.md).\n
## Accounts\n
| Account | Email | Password |
|---|---|---|
| Presenter A | ${a.email} | ${password} |
| Presenter B | ${b.email} | ${password} |
| New registration (not created yet) | demo-${run}-new@example.com | ${password} |

Administrator: use SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD from your private .env.\n
## Prepared flights\n
| Purpose | Flight | Route | Date | Departure | Free seats |
|---|---|---|---|---|---|
| Booking and competition | ${normal.number} | DEL → BLR | ${date} | 09:00 | 80 |
| Waitlist | ${full.number} | DEL → BHO | ${date} | 13:00 | 0 |
| Cancel this flight | ${source.number} | BHO → DEL | ${recoveryDate} | 09:00 | 78 |
| Replacement | ${replacement.number} | BHO → DEL | ${recoveryDate} | 13:00 | 1 |

- [Normal flight](${origin}/?flight=${normal.id}) · [Cabin](${origin}/?view=seats&flight=${normal.id})
- [Full flight](${origin}/?flight=${full.id})
- A's booking to cancel for the waitlist: ${bookingLink(waitlistPayment)}
- [Admin cancellation](${origin}/?view=admin&flight=${source.id})
- Recovery booking A: ${bookingLink(firstPayment)}
- Recovery booking B: ${bookingLink(secondPayment)}
- [My bookings](${origin}/?view=bookings) · [Messages](${origin}/?view=bookings&tab=messages)\n
Expected recovery: A moves to ${replacement.number}, seat 1A, retaining ₹4,500.23 paid fare; B becomes UNASSIGNED. The replacement's advertised fare is ₹6,000.01.\n
No waitlist entry or cancellation has been started. Register the new passenger live. Rehearsing changes these records: run demo:prepare again for a fresh set; earlier records are retained.\n`;
  await mkdir('demo', { recursive: true });
  await writeFile('demo/current.md', markdown);
  console.log(`Demo ready: 4 flights, 81 registered passengers, ${paymentIds.length} confirmed bookings.`);
  console.log('Open demo/current.md for the dates, presenter logins and direct links.');
}

try {
  await prepare();
} catch (error) {
  console.error('Demo preparation failed:', error instanceof Error ? error.message : 'Unknown error');
  console.error(`Existing data was not deleted. Any partial demo records have the demo-${run} account prefix. Rerun for a fresh set.`);
  process.exitCode = 1;
} finally {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
}
