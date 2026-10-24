# FlightSure

Flight reservation learning project. Currently includes the backend, database and seed data.

Requires Node.js 24.17.0 and Docker Desktop running.

## Setup

Copy `.env.example` to `.env` if you do not already have one. Run from the project folder:

```sh
npm install
npm run db:start
npm run db:migrate
npm run db:seed
npm run dev
```

Check: [localhost:3000/health](http://localhost:3000/health).

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Start backend; restart on code changes |
| `npm run typecheck` | Check TypeScript |
| `npm run db:start` | Start PostgreSQL |
| `npm run db:stop` | Stop PostgreSQL; keep data |
| `npm run db:migrate` | Apply new database structure changes |
| `npm run db:seed` | Add admin, airports, flights and seats |
| `npm run db:shell` | Open SQL terminal; exit with `\q` |

Only the admin is seeded; passengers will register. Seeds start tomorrow in IST, or on `SEED_START_DATE` from `.env`.

On later workdays, use `db:start` and `dev`. Run migrations when new ones are added. Press Ctrl+C to stop the backend.
