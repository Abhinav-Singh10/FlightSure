# FlightSure

Flight reservation project. Currently registration, login, flight search, cabin selection, seat holds, simulated payments and bookings.

Requires Node.js 24.17.0 and Docker Desktop running.

## Setup

Copy `.env.example` to `.env`, or add its new keys to your existing file. Keep existing secrets. Set `APP_ORIGIN=http://localhost:5173`.

```sh
npm install
npm run db:start
npm run db:migrate
npm run db:seed
npm run dev
```

In another terminal, run `npm run web`. Open [localhost:5173](http://localhost:5173).

Login uses a signed JWT containing a session ID, with a 15-minute expiry.

The database session identifies the user and records logout.

Search → Flight details → View seats → Full-screen cabin → Checkout. Enter passenger name and age, then pay through the demo card dialog. My bookings shows confirmation and cancellation. Seat holds last up to five minutes, capped at departure; the backend checks expiry every five seconds. Refresh restores a hold or submitted payment in the same browser tab.

Use any 16-digit fake card number, a current or future expiry and a three-digit CVV. The demo payment result defaults to success; choose failure or success after 30 seconds to try those scenarios. Card numbers do not determine the result. Card fields stay in the dialog; only passenger details and the simulator outcome are sent to the backend.

Pending payments continue after logout or a backend restart. Cancellation releases the seat; this demo does not calculate refunds or fees.

Full flight → Join waitlist → Seat offer → Accept → Checkout. My bookings has Bookings, Waitlist and Messages tabs. Waiting passengers receive released seats in joining order. Offers last up to five minutes; acceptance keeps the deadline. All three tabs and open booking details refresh every five seconds while visible. Messages are in-app only.

Administrators log in to the Admin page, find a flight and confirm cancellation with a reason. Recovery runs automatically: passengers keep their booking reference and paid fare, and receive either a replacement within 24 hours of the original departure or an unassigned booking. Waiting passengers on replacement flights get seats first. Progress and passenger messages survive restarts. Rescheduling and refunds are not included.

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Start backend on port 3000 |
| `npm run web` | Start frontend on port 5173 |
| `npm run typecheck` | Check TypeScript |
| `npm run build` | Build frontend into `dist` |
| `npm test` | Run the ten Jest tests |
| `npm run db:start` | Start PostgreSQL |
| `npm run db:stop` | Stop PostgreSQL; keep data |
| `npm run db:migrate` | Apply new database structure changes |
| `npm run db:seed` | Add admin, airports, flights and seats |
| `npm run demo:prepare` | Prepare a fresh presentation; write dates/logins/links to `demo/current.md` |
| `npm run db:shell` | Open SQL terminal; exit with `\q` |

Only the admin is seeded. Passengers register. Each new flight gets 20 rows (A–D), 80 seats and an aisle after B. Rerunning the seed skips existing flights.

For the older `aircraft_seats` database only, run `npx tsx --env-file=.env database/convert-legacy.ts` before migrations. It converts existing records in one transaction and keeps the originals in `legacy_archive`, including a seat-ID translation table. Existing accounts and passwords stay intact; old cabin sizes remain unchanged. The configured local databases have already been converted. Old worker jobs stay archived; the current worker resumes work from business records.

Seeds start tomorrow in IST, or on `SEED_START_DATE` from `.env`. Admin email/password are in `.env` (defaults in `.env.example`).

For the ten-minute presentation, follow [demo/presentation.md](demo/presentation.md). Demo preparation uses registration and booking APIs, keeps existing records, and leaves normal seeds unchanged. Run it again after rehearsal for fresh scenarios.

## Tests

Create the test database once:

```sh
docker compose exec postgres createdb -U flightsure flightsure_test
```

Set `TEST_DATABASE_URL` as shown in `.env.example`, then run `npm test`. Tests reuse migrations/seeds in that database and clean up only their own fixtures.

The test command loads `.env`, enables Jest's ES module support (`--experimental-vm-modules`) and runs tests one file at a time (`--runInBand`). `ts-jest` lets Jest read TypeScript.

On later workdays, start the database and both servers. Press Ctrl+C to stop each server. Health check: [localhost:3000/health](http://localhost:3000/health).
