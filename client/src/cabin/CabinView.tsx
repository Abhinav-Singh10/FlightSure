import { useEffect, useState } from 'react';
import './cabin.css';
import type { Flight, SeatMap, User } from '../../../shared/types.ts';
import { loadFlight, loadSeats } from '../api.ts';
import { flightDate, flightTime } from '../display.ts';
import { SeatPicker } from './SeatPicker.tsx';
import { Button } from '../components/ui/button.tsx';
import { Card } from '../components/ui/card.tsx';
import { ArrowLeftIcon, ArrowRightIcon } from './CabinIcons.tsx';

export function CabinView({ id, user, onBack, onLogin, onSessionExpired, onCheckout, onBooking, onBookings, onEntry }: {
  id: string;
  user: User | null;
  onBack: () => void;
  onLogin: () => void;
  onSessionExpired: () => void;
  onCheckout: (id: string) => void;
  onBooking: (id: string) => void;
  onBookings: () => void;
  onEntry: (id: string) => void;
}) {
  const [flight, setFlight] = useState<Flight | null>(null);
  const [seats, setSeats] = useState<SeatMap | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    Promise.all([loadFlight(id), loadSeats(id)])
      .then(([flight, seats]) => {
        if (active) { setFlight(flight); setSeats(seats); }
      })
      .catch((error: unknown) => {
        if (active) setError(error instanceof Error ? error.message : 'Unable to load the cabin.');
      });
    return () => { active = false; };
  }, [id]);

  return <section aria-label="Seat selection" className="space-y-6">
    <Button variant="ghost" className="px-0 text-primary" onClick={onBack}>
      <ArrowLeftIcon className="size-4" /> Back to flight details
    </Button>
    <div className="cabin-heading">
      <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">Choose your seat</h1>
      {flight && <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2">
        <p className="flex items-center gap-3 text-lg font-bold sm:text-xl">
          {flight.origin.name}<ArrowRightIcon className="size-5 text-primary" />{flight.destination.name}
        </p>
        <p className="text-sm text-muted-foreground sm:border-l sm:border-border sm:pl-6">
          {flightDate(flight.departureAt)} · {flightTime(flight.departureAt)} IST · {flight.flightNumber}
        </p>
      </div>}
    </div>
    {error ? <Card role="alert" className="text-red-800">{error}</Card> : !flight || !seats ? <Card role="status">Loading cabin…</Card> :
      <SeatPicker key={`${id}:${user?.id ?? 'guest'}`} flight={flight} initialSeats={seats} user={user}
        onFlightChange={setFlight} onLogin={onLogin} onSessionExpired={onSessionExpired} onCheckout={onCheckout} onBooking={onBooking} onBookings={onBookings} onEntry={onEntry} />}
  </section>;
}
