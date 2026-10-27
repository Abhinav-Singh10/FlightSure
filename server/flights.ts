import { Router } from 'express';
import { z } from 'zod';
import { pool } from './db.ts';
import { fail, meta } from './http.ts';
import { formatIst, isCalendarDate, todayInIst } from './time.ts';
import type { Airport, Flight, SeatMap } from '../shared/types.ts';

export const flights = Router();

const airport = z.enum(['DEL', 'BHO', 'BLR']);
const searchQuery = z
  .object({
    origin: airport,
    destination: airport,
    departureDate: z.string(),
    page: z.string().optional(),
    limit: z.string().optional(),
  })
  .strict();
const flightPath = z.object({ flightId: z.string().uuid() }).strict();

type FlightRow = {
  id: string;
  flight_number: string;
  origin: Airport['code'];
  origin_name: Airport['name'];
  destination: Airport['code'];
  destination_name: Airport['name'];
  departure_at: Date;
  arrival_at: Date;
  status: Flight['status'];
  fare_paise: number;
  available_seats: number;
};

// Until holds/bookings are added, all physical seats are available.
const flightSelect = `
  SELECT f.*, origin_airport.name AS origin_name, destination_airport.name AS destination_name,
    (SELECT count(*)::int FROM flight_seats WHERE flight_id = f.id) AS available_seats
  FROM flights f
  JOIN airports origin_airport ON origin_airport.code = f.origin
  JOIN airports destination_airport ON destination_airport.code = f.destination
`;

function flightData(row: FlightRow): Flight {
  return {
    id: row.id,
    flightNumber: row.flight_number,
    origin: { code: row.origin, name: row.origin_name },
    destination: { code: row.destination, name: row.destination_name },
    departureAt: formatIst(row.departure_at),
    arrivalAt: formatIst(row.arrival_at),
    status: row.status,
    fare: { amountMinor: row.fare_paise, currency: 'INR' },
    availableSeats: row.available_seats,
    bookable:
      row.status === 'SCHEDULED' && row.departure_at.getTime() > Date.now(),
  };
}

flights.get('/', async (request, response) => {
  const input = searchQuery.parse(request.query);
  // Query parameters arrive as text. Use defaults when pagination is omitted.
  const page = Number(input.page ?? 1);
  const limit = Number(input.limit ?? 20);
  if (!Number.isSafeInteger(page) || page < 1) {
    fail(
      response,
      400,
      'VALIDATION_ERROR',
      'Page must be a positive whole number.',
      [{ field: 'page', message: 'Use a positive whole number.' }],
    );
    return;
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    fail(
      response,
      400,
      'VALIDATION_ERROR',
      'Limit must be a whole number from 1 to 100.',
      [{ field: 'limit', message: 'Use a whole number from 1 to 100.' }],
    );
    return;
  }
  if (input.origin === input.destination) {
    fail(
      response,
      400,
      'INVALID_ROUTE',
      'Choose different origin and destination airports.',
    );
    return;
  }
  if (!isCalendarDate(input.departureDate)) {
    fail(response, 400, 'VALIDATION_ERROR', 'Choose a valid departure date.', [
      { field: 'departureDate', message: 'Use a valid YYYY-MM-DD date.' },
    ]);
    return;
  }
  if (input.departureDate < todayInIst()) {
    fail(response, 400, 'PAST_DATE', 'Choose today or a future date.');
    return;
  }
  const where = `WHERE f.origin = $1 AND f.destination = $2 AND f.status = 'SCHEDULED'
    AND f.departure_at > now()
    AND f.departure_at >= ($3::date::timestamp AT TIME ZONE 'Asia/Kolkata')
    AND f.departure_at < (($3::date + 1)::timestamp AT TIME ZONE 'Asia/Kolkata')`;
  const values = [input.origin, input.destination, input.departureDate];
  const count = await pool.query<{ total: number }>(
    `SELECT count(*)::int AS total FROM flights f ${where}`,
    values,
  );
  const result = await pool.query<FlightRow>(
    `${flightSelect} ${where} ORDER BY f.departure_at, f.id LIMIT $4 OFFSET $5`,
    [...values, limit, (page - 1) * limit],
  );
  response.json({
    data: result.rows.map(flightData),
    pagination: { page, limit, total: count.rows[0].total },
    meta: meta(),
  });
});

flights.get('/:flightId', async (request, response) => {
  z.object({}).strict().parse(request.query);
  const { flightId } = flightPath.parse(request.params);
  const result = await pool.query<FlightRow>(
    `${flightSelect} WHERE f.id = $1`,
    [flightId],
  );
  const row = result.rows[0];
  if (!row) {
    fail(response, 404, 'FLIGHT_NOT_FOUND', 'Flight not found.');
    return;
  }
  response.json({ data: flightData(row), meta: meta() });
});

flights.get('/:flightId/seats', async (request, response) => {
  z.object({}).strict().parse(request.query);
  const { flightId } = flightPath.parse(request.params);
  const layoutResult = await pool.query<{
    name: string;
    columns: string[];
    aisle_after: string[];
  }>(
    'SELECT a.name, a.columns, a.aisle_after FROM flights f JOIN aircraft_layouts a ON a.id = f.layout_id WHERE f.id = $1',
    [flightId],
  );
  const layout = layoutResult.rows[0];
  if (!layout) {
    fail(response, 404, 'FLIGHT_NOT_FOUND', 'Flight not found.');
    return;
  }
  const result = await pool.query<{
    id: string;
    label: string;
    row_number: number;
    column_letter: string;
  }>(
    'SELECT id, label, row_number, column_letter FROM flight_seats WHERE flight_id = $1 ORDER BY row_number, column_letter',
    [flightId],
  );
  const data: SeatMap = {
    flightId,
    layout: {
      aircraftName: layout.name,
      columns: layout.columns,
      aisleAfter: layout.aisle_after,
    },
    seats: result.rows.map((seat) => ({
      id: seat.id,
      label: seat.label,
      row: seat.row_number,
      column: seat.column_letter,
      status: 'AVAILABLE',
      isMine: false,
    })),
  };
  response.json({ data, meta: meta() });
});
