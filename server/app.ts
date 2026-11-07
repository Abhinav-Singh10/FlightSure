import express from 'express';
import cookieParser from 'cookie-parser';
import { pool } from './db.ts';
import { auth } from './auth.ts';
import { flights } from './flights.ts';
import { holds } from './holds.ts';
import { payments } from './payments.ts';
import { bookings } from './bookings.ts';
import { waitlist } from './waitlist.ts';
import { admin } from './admin.ts';
import { errorHandler, fail } from './http.ts';

export const app = express();

app.use(express.json());
app.use(cookieParser());

app.get('/health', async (_request, response) => {
  response.set('Cache-Control', 'no-store');
  try {
    await pool.query('SELECT 1');
    response.json({ status: 'ok', database: 'connected' });
  } catch {
    response.status(503).json({ status: 'error', database: 'unavailable' });
  }
});

app.use('/api/auth', auth);
app.use('/api/flights', flights);
app.use('/api', payments);
app.use('/api/holds', holds);
app.use('/api/bookings', bookings);
app.use('/api', waitlist);
app.use('/api/admin', admin);
app.use('/api', (_request, response) => {
  fail(response, 404, 'NOT_FOUND', 'API route not found.');
});
app.use(errorHandler);
