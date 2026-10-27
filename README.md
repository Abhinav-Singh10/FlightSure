# FlightSure

Flight reservation project. Includes registration, login, flight search and details.

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

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Start backend on port 3000 |
| `npm run web` | Start frontend on port 5173 |
| `npm run typecheck` | Check TypeScript |
| `npm run build` | Build frontend into `dist` |
| `npm test` | Run the three Jest tests |
| `npm run db:start` | Start PostgreSQL |
| `npm run db:stop` | Stop PostgreSQL; keep data |
| `npm run db:migrate` | Apply new database structure changes |
| `npm run db:seed` | Add admin, airports, flights and seats |
| `npm run db:shell` | Open SQL terminal; exit with `\q` |

Only the admin is seeded. Passengers register. 

Seeds start tomorrow in IST, or on `SEED_START_DATE` from `.env`. Admin email/password are in `.env` (defaults in `.env.example`).

## Tests

Create the test database once:

```sh
docker compose exec postgres createdb -U flightsure flightsure_test
```

Set `TEST_DATABASE_URL` as shown in `.env.example`, then run `npm test`. Tests reuse migrations/seeds in that database and clean up only their own passengers.

The test command loads `.env`, enables Jest's ES module support (`--experimental-vm-modules`) and runs tests one file at a time (`--runInBand`). `ts-jest` lets Jest read TypeScript.

On later workdays, start the database and both servers. Press Ctrl+C to stop each server. Health check: [localhost:3000/health](http://localhost:3000/health).
