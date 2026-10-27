import bcrypt from 'bcrypt';
import { pool } from '../server/db.ts';

type IdRow = { id: string };
type AccountRow = { role: string };

const airports = [
  { code: 'DEL', name: 'Delhi' },
  { code: 'BHO', name: 'Bhopal' },
  { code: 'BLR', name: 'Bangalore' },
];

const layoutName = 'FlightSure 2-2 cabin';
const columns = ['A', 'B', 'C', 'D'];
const rowCount = 3;
const departureHours = [9, 13, 17];
const dayInMilliseconds = 24 * 60 * 60 * 1000;

async function seed() {
  const adminEmail = (process.env.SEED_ADMIN_EMAIL ?? 'admin@flightsure.test')
    .trim()
    .toLowerCase();
  const adminPassword = process.env.SEED_ADMIN_PASSWORD;

  if (!adminEmail.includes('@') || adminEmail.length > 254) {
    throw new Error('SEED_ADMIN_EMAIL must be a valid email address.');
  }
  if (
    !adminPassword ||
    adminPassword.length < 8 ||
    Buffer.byteLength(adminPassword, 'utf8') > 72
  ) {
    throw new Error(
      'SEED_ADMIN_PASSWORD needs at least 8 characters and at most 72 UTF-8 bytes.',
    );
  }

  // IST has a fixed +05:30 offset. Shift before extracting tomorrow's calendar date.
  const tomorrowInIst = new Date(
    Date.now() + 330 * 60 * 1000 + dayInMilliseconds,
  );
  const startDate =
    process.env.SEED_START_DATE ?? tomorrowInIst.toISOString().slice(0, 10);
  const firstDay = new Date(`${startDate}T00:00:00Z`);

  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(startDate) ||
    Number.isNaN(firstDay.getTime()) ||
    firstDay.toISOString().slice(0, 10) !== startDate
  ) {
    throw new Error(
      'SEED_START_DATE must be a valid YYYY-MM-DD calendar date.',
    );
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const existingAdmin = await client.query<AccountRow>(
      'SELECT role FROM accounts WHERE email = $1',
      [adminEmail],
    );
    const account = existingAdmin.rows[0];

    if (account && account.role !== 'ADMIN') {
      throw new Error(
        'The seed admin email already belongs to a passenger account.',
      );
    }
    if (!account) {
      const passwordHash = await bcrypt.hash(adminPassword, 12);
      await client.query(
        "INSERT INTO accounts (email, password_hash, role) VALUES ($1, $2, 'ADMIN')",
        [adminEmail, passwordHash],
      );
    }

    for (const airport of airports) {
      await client.query(
        'INSERT INTO airports (code, name) VALUES ($1, $2) ON CONFLICT (code) DO NOTHING',
        [airport.code, airport.name],
      );
    }

    await client.query(
      `INSERT INTO aircraft_layouts (name, row_count, columns, aisle_after)
       VALUES ($1, $2, $3, $4) ON CONFLICT (name) DO NOTHING`,
      [layoutName, rowCount, columns, ['B']],
    );
    const layoutResult = await client.query<IdRow>(
      'SELECT id FROM aircraft_layouts WHERE name = $1',
      [layoutName],
    );
    const layout = layoutResult.rows[0];
    if (!layout) throw new Error('The seed cabin layout was not found.');

    let routeNumber = 100;

    for (const origin of airports) {
      for (const destination of airports) {
        if (origin.code === destination.code) continue;
        routeNumber += 1;

        for (let day = 0; day < 3; day += 1) {
          const date = new Date(firstDay.getTime() + day * dayInMilliseconds)
            .toISOString()
            .slice(0, 10);

          for (const hour of departureHours) {
            const flightNumber = `FS${routeNumber}${hour}`;
            const departureAt = `${date}T${String(hour).padStart(2, '0')}:00:00+05:30`;
            const arrivalAt = `${date}T${String(hour + 2).padStart(2, '0')}:00:00+05:30`;

            await client.query(
              `INSERT INTO flights
                 (flight_number, origin, destination, departure_at, arrival_at, fare_paise, layout_id)
               VALUES ($1, $2, $3, $4, $5, $6, $7)
               ON CONFLICT (flight_number, departure_at) DO NOTHING`,
              [
                flightNumber,
                origin.code,
                destination.code,
                departureAt,
                arrivalAt,
                450000,
                layout.id,
              ],
            );
            const flightResult = await client.query<IdRow>(
              'SELECT id FROM flights WHERE flight_number = $1 AND departure_at = $2',
              [flightNumber, departureAt],
            );
            const flight = flightResult.rows[0];
            if (!flight) throw new Error('A seeded flight was not found.');

            for (let row = 1; row <= rowCount; row += 1) {
              for (const column of columns) {
                await client.query(
                  `INSERT INTO flight_seats (flight_id, label, row_number, column_letter)
                   VALUES ($1, $2, $3, $4) ON CONFLICT (flight_id, label) DO NOTHING`,
                  [flight.id, `${row}${column}`, row, column],
                );
              }
            }
          }
        }
      }
    }

    await client.query('COMMIT');
    console.log(
      `Seeds ready for ${startDate} and the next two days: 54 flights, 12 seats per flight.`,
    );
    console.log(
      'Existing records and the admin password were preserved. No passengers were seeded.',
    );
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

try {
  await seed();
} catch (error) {
  console.error(
    'Seeding failed:',
    error instanceof Error ? error.message : 'Unknown error',
  );
  process.exitCode = 1;
} finally {
  await pool.end();
}
