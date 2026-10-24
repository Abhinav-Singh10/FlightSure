import express from 'express';
import { pool } from './db.ts';

const app = express();
const port = Number(process.env.PORT ?? 3000);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be an integer between 1 and 65535.');
}

// DB pool connection checking
app.get('/health', async (_request, response) => {
  response.set('Cache-Control', 'no-store');

  try {
    await pool.query('SELECT 1');
    response.json({ status: 'ok', database: 'connected' });
  } catch {
    response.status(503).json({ status: 'error', database: 'unavailable' });
  }
});

// main server
const server = app.listen(port, '127.0.0.1', () => {
  console.log(`FlightSure backend: http://127.0.0.1:${port}`);
});

// PORT error check
server.on('error', () => {
  console.error('The backend could not start. Check whether PORT is already in use.');
  process.exitCode = 1;
});


function stopServer() {
  server.close(() => {
    pool.end().catch(() => {
      console.error('The database connections could not close cleanly.');
      process.exitCode = 1;
    });
  });
}

process.on('SIGINT', stopServer);
process.on('SIGTERM', stopServer);
