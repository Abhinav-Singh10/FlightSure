import { readdir, readFile } from 'node:fs/promises';
import { pool } from '../server/db.ts';

// One-time conversion of the older aircraft_seats/jobs schema found locally.
// Original tables remain in legacy_archive. An error rolls back the entire conversion.
async function convertLegacy() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const legacy = await client.query(`SELECT to_regclass('public.aircraft_seats') AS table_name`);
    if (!legacy.rows[0]?.table_name) {
      console.log('No legacy schema found; nothing changed.');
      await client.query('ROLLBACK');
      return;
    }

    const tables = await client.query<{ tablename: string; }>(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
    );
    const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;
    for (const table of tables.rows) {
      await client.query(`LOCK TABLE public.${quote(table.tablename)} IN ACCESS EXCLUSIVE MODE`);
    }

    // These legacy structures were empty in the inspected databases. Their old
    // formats need a separate mapping if another database contains such records.
    for (const table of ['cancellation_tasks', 'assignment_history', 'idempotency_records']) {
      const result = await client.query(`SELECT 1 FROM ${quote(table)} LIMIT 1`);
      if (result.rowCount) throw new Error(`Cannot convert nonempty legacy ${table} automatically.`);
    }

    await client.query('CREATE SCHEMA legacy_archive');
    for (const table of tables.rows) {
      await client.query(`ALTER TABLE public.${quote(table.tablename)} SET SCHEMA legacy_archive`);
    }

    await client.query(`CREATE TABLE schema_migrations (
      filename text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const migrations = (await readdir('database/migrations'))
      .filter((name) => /^\d+_.*\.sql$/.test(name)).sort();
    for (const filename of migrations) {
      await client.query(await readFile(`database/migrations/${filename}`, 'utf8'));
      await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [filename]);
    }

    await client.query(`
      INSERT INTO accounts SELECT id, lower(trim(email)), password_hash, role, created_at
        FROM legacy_archive.accounts;
      INSERT INTO sessions (id, account_id, created_at, expires_at, revoked_at)
        SELECT id, account_id, created_at, expires_at, revoked_at FROM legacy_archive.sessions;
      INSERT INTO airports SELECT * FROM legacy_archive.airports;
      INSERT INTO aircraft_layouts (id, name, row_count, columns, aisle_after)
        SELECT a.id, a.name, max(s.row_number), a.columns, a.aisle_after
        FROM legacy_archive.aircraft_layouts a
        JOIN legacy_archive.aircraft_seats s ON s.aircraft_id = a.id GROUP BY a.id;
      INSERT INTO flights (id, flight_number, origin, destination, departure_at, arrival_at,
                           status, fare_paise, layout_id)
        SELECT id, flight_number, origin, destination, departure_at, arrival_at,
               status, fare_paise, aircraft_id FROM legacy_archive.flights;

      -- Old seat IDs were shared by many flights. Keep a permanent translation
      -- beside the archived originals, without changing visible seat labels.
      CREATE TABLE legacy_archive.seat_id_map AS
        SELECT flight_id, seat_id AS old_seat_id, gen_random_uuid() AS new_seat_id
        FROM legacy_archive.flight_seats;
      ALTER TABLE legacy_archive.seat_id_map ADD PRIMARY KEY (flight_id, old_seat_id);
      INSERT INTO flight_seats (id, flight_id, label, row_number, column_letter)
        SELECT m.new_seat_id, m.flight_id, s.label, s.row_number, s.column_letter
        FROM legacy_archive.seat_id_map m
        JOIN legacy_archive.aircraft_seats s ON s.id = m.old_seat_id;
      INSERT INTO holds (id, account_id, flight_id, seat_id, source, status,
                         quote_paise, created_at, expires_at)
        SELECT h.id, h.account_id, h.flight_id, m.new_seat_id, h.source, h.status,
               h.quote_paise, h.created_at, h.expires_at
        FROM legacy_archive.holds h JOIN legacy_archive.seat_id_map m
          ON m.flight_id = h.flight_id AND m.old_seat_id = h.seat_id;
      INSERT INTO payments (id, hold_id, status, amount_paise, requested_outcome,
                            delay_seconds, created_at, due_at, completed_at, reason)
        SELECT id, hold_id, status, amount_paise, simulated_outcome,
               CASE WHEN simulated_outcome = 'DELAYED_SUCCESS'
                 THEN greatest(1, least(600, extract(epoch FROM due_at - created_at)::integer)) END,
               created_at, due_at, completed_at, reason FROM legacy_archive.payments;
      INSERT INTO bookings (id, payment_id, account_id, reference, status, original_flight_id,
                            current_flight_id, seat_id, fare_paid_paise, confirmed_at, cancellation_reason)
        SELECT b.id, b.payment_id, b.account_id, b.reference, b.status, b.original_flight_id,
               b.current_flight_id, m.new_seat_id, b.fare_paid_paise, b.confirmed_at, b.cancellation_reason
        FROM legacy_archive.bookings b LEFT JOIN legacy_archive.seat_id_map m
          ON m.flight_id = b.current_flight_id AND m.old_seat_id = b.seat_id;
      INSERT INTO booking_assignments (booking_id, flight_id, seat_id, assigned_at)
        SELECT b.id, h.flight_id, h.seat_id, b.confirmed_at
        FROM bookings b JOIN payments p ON p.id = b.payment_id JOIN holds h ON h.id = p.hold_id;
      INSERT INTO booking_assignments (booking_id, flight_id, seat_id, assigned_at)
        SELECT id, current_flight_id, seat_id, confirmed_at FROM bookings
        WHERE current_flight_id IS NOT NULL ON CONFLICT DO NOTHING;
      INSERT INTO waitlist_entries (id, account_id, flight_id, status, joined_at,
                                    offer_hold_id, accepted_at, booking_id)
        SELECT id, account_id, flight_id, status, joined_at, offer_hold_id, accepted_at, booking_id
        FROM legacy_archive.waitlist_entries;
      INSERT INTO notifications (id, account_id, event_key, type, message, flight_id,
                                booking_id, waitlist_entry_id, created_at)
        SELECT id, account_id, event_key, type, message, flight_id, booking_id, waitlist_entry_id, created_at
        FROM legacy_archive.notifications;
      INSERT INTO seat_allocations (seat_id, flight_id, account_id, hold_id)
        SELECT m.new_seat_id, s.flight_id, h.account_id, h.id
        FROM legacy_archive.flight_seats s JOIN legacy_archive.seat_id_map m
          ON m.flight_id = s.flight_id AND m.old_seat_id = s.seat_id
        JOIN holds h ON h.id = s.hold_id;
      INSERT INTO seat_allocations (seat_id, flight_id, account_id, booking_id)
        SELECT m.new_seat_id, s.flight_id, b.account_id, b.id
        FROM legacy_archive.flight_seats s JOIN legacy_archive.seat_id_map m
          ON m.flight_id = s.flight_id AND m.old_seat_id = s.seat_id
        JOIN bookings b ON b.id = s.booking_id;
    `);

    // Do not silently drop rows through a missing seat mapping or broken relationship.
    for (const table of ['accounts', 'sessions', 'airports', 'aircraft_layouts', 'flights',
      'flight_seats', 'holds', 'payments', 'bookings', 'waitlist_entries', 'notifications']) {
      const result = await client.query<{ matches: boolean; }>(`
        SELECT (SELECT count(*) FROM public.${quote(table)}) =
               (SELECT count(*) FROM legacy_archive.${quote(table)}) AS matches`);
      if (!result.rows[0]?.matches) throw new Error(`Record count changed for ${table}.`);
    }
    const passwords = await client.query(`
      SELECT 1 FROM legacy_archive.accounts old JOIN accounts current USING (id)
      WHERE old.password_hash <> current.password_hash LIMIT 1`);
    if (passwords.rowCount) throw new Error('An account password changed.');

    await client.query('COMMIT');
    console.log('Legacy records converted. Original tables and seat ID map retained in legacy_archive.');
    console.log('Old jobs remain archived; the current worker reads payments, waitlists and recovery items directly.');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

try {
  await convertLegacy();
} catch (error) {
  console.error('Conversion failed:', error instanceof Error ? error.message : 'Unknown error');
  process.exitCode = 1;
} finally {
  await pool.end();
}
