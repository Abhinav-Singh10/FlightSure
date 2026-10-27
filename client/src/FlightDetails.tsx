import { useEffect, useState } from 'react';
import type { Flight, SeatMap } from '../../shared/types.ts';
import { loadFlight, loadSeats } from './api.ts';
import { flightDate, flightTime, money } from './display.ts';
import { Button } from './components/ui/button.tsx';
import { Card } from './components/ui/card.tsx';

export function FlightDetails({
  id,
  onBack,
}: {
  id: string;
  onBack: () => void;
}) {
  const [flight, setFlight] = useState<Flight | null>(null);
  const [seats, setSeats] = useState<SeatMap | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    Promise.all([loadFlight(id), loadSeats(id)])
      .then(([flight, seats]) => {
        if (active) {
          setFlight(flight);
          setSeats(seats);
        }
      })
      .catch((error: unknown) => {
        if (active)
          setError(
            error instanceof Error
              ? error.message
              : 'Unable to load this flight.',
          );
      });
    return () => {
      active = false;
    };
  }, [id]);

  return (
    <section className="space-y-5">
      <Button variant="ghost" onClick={onBack} className="px-0">
        ← Back to results
      </Button>
      {error ? (
        <Card role="alert" className="text-red-800">
          {error}
        </Card>
      ) : !flight || !seats ? (
        <Card role="status">Loading flight details…</Card>
      ) : (
        <Card>
          <div className="mb-7 flex flex-wrap items-start justify-between gap-3 border-b border-border pb-5">
            <div>
              <p className="mb-2 text-xs font-semibold tracking-widest text-primary">
                FLIGHT DETAILS
              </p>
              <h2 className="text-2xl font-semibold">
                {flight.origin.name} to {flight.destination.name}
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                {flight.flightNumber} · {flightDate(flight.departureAt)}
              </p>
            </div>
            <span className="rounded-full bg-muted px-3 py-1 text-xs font-semibold">
              {flight.status}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-5">
            <div>
              <p className="text-xs font-semibold tracking-wide text-muted-foreground">
                DEPARTURE
              </p>
              <p className="mt-2 text-4xl font-semibold">
                {flightTime(flight.departureAt)}
              </p>
              <p className="mt-2 text-sm">
                {flight.origin.name} ({flight.origin.code})
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {flightDate(flight.departureAt)} · IST
              </p>
            </div>
            <div>
              <p className="text-xs font-semibold tracking-wide text-muted-foreground">
                ARRIVAL
              </p>
              <p className="mt-2 text-4xl font-semibold">
                {flightTime(flight.arrivalAt)}
              </p>
              <p className="mt-2 text-sm">
                {flight.destination.name} ({flight.destination.code})
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {flightDate(flight.arrivalAt)} · IST
              </p>
            </div>
          </div>
          <dl className="mt-8 grid gap-5 border-t border-border pt-6 sm:grid-cols-2">
            <div>
              <dt className="text-xs text-muted-foreground">
                Fare per passenger
              </dt>
              <dd className="mt-1 text-2xl font-semibold">
                {money(flight.fare.amountMinor)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Availability</dt>
              <dd className="mt-1 font-semibold">
                {flight.bookable
                  ? `${flight.availableSeats} seats available`
                  : 'Not currently bookable'}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Aircraft</dt>
              <dd className="mt-1 text-sm font-medium">
                {seats.layout.aircraftName}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Cabin</dt>
              <dd className="mt-1 text-sm font-medium">
                {seats.seats.length} seats ·{' '}
                {new Set(seats.seats.map((seat) => seat.row)).size} rows
              </dd>
            </div>
          </dl>
        </Card>
      )}
    </section>
  );
}
