# FlightSure

Flight reservation learning project built with React, TypeScript, Express and PostgreSQL. Includes registration, flight search, seat selection, simulated payments, bookings, waitlists, notifications and admin cancellation with automatic rebooking.

## Setup

Requires Node.js 24.17.0 or newer within Node 24, and Docker Desktop running.

For a new setup:

```sh
cp .env.example .env
```

If `.env` already exists, keep it and add any missing keys from `.env.example`. Set `APP_ORIGIN=http://localhost:5173`, your `JWT_SECRET`, and `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`. 

Optional: set `SEED_START_DATE=YYYY-MM-DD`; otherwise flights start tomorrow in IST.

```sh
npm install
npm run db:start
npm run db:migrate
npm run db:seed
```

After seeding, run `npm run demo:prepare` to recreate the scenario shown in the demo video. It prepares these two demo passenger accounts:

| Passenger | Email | Password |
|---|---|---|
| passengerA | pass1@gmail.com | passenger1 |
| passengerB | pass2@gmail.com | passenger2 |

Backend terminal:

```sh
npm run dev
```

Frontend terminal:

```sh
npm run web
```

App: [localhost:5173](http://localhost:5173). Health: [localhost:3000/health](http://localhost:3000/health). 

Admin login uses the seeded credentials from `.env`.

Test database setup (once):

```sh
docker compose exec postgres createdb -U flightsure flightsure_test
```

Set `TEST_DATABASE_URL` in `.env` using `.env.example`.

## Scripts

| Command | Task |
|---|---|
| `npm run dev` | Start backend on port 3000 |
| `npm run web` | Start frontend on port 5173 |
| `npm run build` | Build frontend into `dist` |
| `npm test` | Run Jest tests |
| `npm run db:start` | Start PostgreSQL |
| `npm run db:stop` | Stop PostgreSQL, preserving data |
| `npm run db:migrate` | Apply database migrations |
| `npm run db:seed` | Seed admin, airports, flights and seats |
| `npm run db:shell` | Open SQL terminal (`\q` to exit) |
| `npm run demo:prepare` | Prepare demo data and write `demo/current.md` |
