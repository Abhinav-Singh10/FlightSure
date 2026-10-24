import pg from 'pg';

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('Set DATABASE_URL in .env before starting the application.');
}

// Reuse a small pool instead of opening a new database connection per request.
export const pool = new pg.Pool({
  connectionString,
  max: 5,
  connectionTimeoutMillis: 3000,
});

pool.on('error', () => {
  console.error('An idle database connection failed. Check that PostgreSQL is running.');
});
