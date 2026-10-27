import { useState } from 'react';
import type { SubmitEvent } from 'react';
import type { Flight, Pagination } from '../../shared/types.ts';
import { searchFlights } from './api.ts';
import { flightDate, flightTime, money, today, tomorrow } from './display.ts';
import { Button } from './components/ui/button.tsx';
import { Input } from './components/ui/input.tsx';
import { Card } from './components/ui/card.tsx';

const airports = [
  { code: 'DEL', name: 'Delhi' },
  { code: 'BHO', name: 'Bhopal' },
  { code: 'BLR', name: 'Bangalore' },
];
type Results = {
  flights: Flight[];
  pagination: Pagination;
  origin: string;
  destination: string;
  date: string;
};

export function FlightSearch({ onOpen }: { onOpen: (id: string) => void }) {
  const [origin, setOrigin] = useState('DEL');
  const [destination, setDestination] = useState('BLR');
  const [date, setDate] = useState(tomorrow());
  const [results, setResults] = useState<Results | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function search(page = 1, route = { origin, destination, date }) {
    setError('');
    if (route.origin === route.destination) {
      setError('Choose different origin and destination airports.');
      return;
    }
    setBusy(true);
    try {
      const response = await searchFlights(
        route.origin,
        route.destination,
        route.date,
        page,
      );
      setResults({
        ...response,
        origin: route.origin,
        destination: route.destination,
        date: route.date,
      });
    } catch (error) {
      setError(
        error instanceof Error ? error.message : 'Unable to search flights.',
      );
    } finally {
      setBusy(false);
    }
  }

  function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    void search();
  }

  return (
    <div className="space-y-7">
      <Card>
        <div className="mb-5 flex items-center gap-2 text-sm font-semibold">
          <span className="text-primary">↗</span> Find a flight
        </div>
        <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm font-medium">
            From
            <select
              className="mt-2 h-12 w-full rounded-lg border border-border bg-white px-3 outline-none focus:ring-2 focus:ring-ring"
              value={origin}
              onChange={(event) => setOrigin(event.target.value)}
            >
              {airports.map((airport) => (
                <option
                  key={airport.code}
                  value={airport.code}
                  disabled={airport.code === destination}
                >
                  {airport.name} ({airport.code})
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm font-medium">
            To
            <select
              className="mt-2 h-12 w-full rounded-lg border border-border bg-white px-3 outline-none focus:ring-2 focus:ring-ring"
              value={destination}
              onChange={(event) => setDestination(event.target.value)}
            >
              {airports.map((airport) => (
                <option
                  key={airport.code}
                  value={airport.code}
                  disabled={airport.code === origin}
                >
                  {airport.name} ({airport.code})
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm font-medium">
            Departure date
            <Input
              className="mt-2"
              type="date"
              min={today()}
              required
              value={date}
              onChange={(event) => setDate(event.target.value)}
            />
          </label>
          <Button className="h-12 self-end" type="submit" disabled={busy}>
            {busy ? 'Searching…' : 'Search flights'}{' '}
            <span aria-hidden="true">→</span>
          </Button>
        </form>
        {error && (
          <p
            role="alert"
            className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-800"
          >
            {error}
          </p>
        )}
      </Card>

      <div aria-live="polite" aria-busy={busy}>
        {!results ? (
          <div className="rounded-2xl border border-dashed border-border px-6 py-12 text-center">
            <span
              aria-hidden="true"
              className="mb-3 inline-block text-3xl text-primary"
            >
              ↗
            </span>
            <h2 className="font-semibold">Where will you go next?</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Choose a route and date to explore available flights.
            </p>
          </div>
        ) : (
          <>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-semibold">
                {results.origin}{' '}
                <span className="px-1 text-muted-foreground">→</span>{' '}
                {results.destination}
              </h2>
              <p className="text-sm text-muted-foreground">
                {results.pagination.total}{' '}
                {results.pagination.total === 1 ? 'flight' : 'flights'} ·{' '}
                {flightDate(results.date)}
              </p>
            </div>
            {results.flights.length === 0 ? (
              <Card className="py-10 text-center">
                <h3 className="font-semibold">No flights found</h3>
                <p className="mt-2 text-sm text-muted-foreground">
                  Try another date or route.
                </p>
              </Card>
            ) : (
              <div className="space-y-3">
                {results.flights.map((flight) => (
                  <Card key={flight.id} className="p-5">
                    <div className="mb-5 flex items-center justify-between gap-2 text-xs">
                      <span className="font-semibold tracking-wide">
                        FLIGHTSURE{' '}
                        <span className="ml-2 font-normal text-muted-foreground">
                          {flight.flightNumber}
                        </span>
                      </span>
                      <span className="rounded-full bg-emerald-50 px-2 py-1 font-medium text-primary">
                        Direct flight
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-5">
                      <div>
                        <p className="text-2xl font-semibold">
                          {flightTime(flight.departureAt)}
                        </p>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {flight.origin.name} · {flight.origin.code}
                        </p>
                      </div>
                      <span
                        aria-hidden="true"
                        className="text-xl text-muted-foreground"
                      >
                        ⟶
                      </span>
                      <div>
                        <p className="text-2xl font-semibold">
                          {flightTime(flight.arrivalAt)}
                        </p>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {flight.destination.name} · {flight.destination.code}
                        </p>
                      </div>
                      <div className="ml-auto text-right">
                        <p className="text-xl font-semibold">
                          {money(flight.fare.amountMinor)}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {flight.availableSeats} seats available
                        </p>
                      </div>
                      <Button
                        variant="outline"
                        disabled={busy}
                        onClick={() => onOpen(flight.id)}
                        aria-label={`View details for ${flight.flightNumber}`}
                      >
                        View details →
                      </Button>
                    </div>
                  </Card>
                ))}
              </div>
            )}
            {results.pagination.total > results.pagination.limit && (
              <div className="mt-4 flex items-center justify-end gap-3 text-sm">
                <Button
                  variant="outline"
                  disabled={busy || results.pagination.page === 1}
                  onClick={() =>
                    void search(results.pagination.page - 1, results)
                  }
                >
                  Previous
                </Button>
                <span>Page {results.pagination.page}</span>
                <Button
                  variant="outline"
                  disabled={
                    busy ||
                    results.pagination.page * results.pagination.limit >=
                      results.pagination.total
                  }
                  onClick={() =>
                    void search(results.pagination.page + 1, results)
                  }
                >
                  Next
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
