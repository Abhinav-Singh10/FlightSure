import { useEffect, useState } from 'react';
import type { Flight, SeatMap, User } from '../../shared/types.ts';
import { loadFlight, loadSeats } from './api.ts';
import { flightDate, flightTime } from './display.ts';
import { SeatPicker } from './SeatPicker.tsx';
import { Button } from './components/ui/button.tsx';
import { Card } from './components/ui/card.tsx';

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
    <div className="flex flex-wrap items-center justify-between gap-3">
      <Button variant="ghost" className="px-0" onClick={onBack}>← Back to flight details</Button>
      <p className="text-xs font-medium tracking-widest text-muted-foreground">01 FLIGHT <span className="mx-3" aria-hidden="true">/</span><span className="text-primary">02 YOUR SEAT</span></p>
    </div>
    <div className="flex flex-wrap items-end justify-between gap-5">
      <div>
        <p className="mb-2 text-xs font-semibold tracking-[0.18em] text-primary">MAKE YOURSELF COMFORTABLE</p>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">A seat for your journey.</h1>
        <p className="mt-3 text-sm text-muted-foreground">Choose a window view or easy aisle access. Your journey starts here.</p>
      </div>
      {flight && <div className="rounded-xl border border-border bg-white px-5 py-3 text-sm">
        <p className="font-semibold">{flight.origin.code} <span className="px-2 text-primary" aria-hidden="true">→</span> {flight.destination.code} <span className="ml-3 text-xs font-normal text-muted-foreground">{flight.flightNumber}</span></p>
        <p className="mt-1 text-xs text-muted-foreground">{flightDate(flight.departureAt)} · {flightTime(flight.departureAt)} IST</p>
      </div>}
    </div>
    {error ? <Card role="alert" className="text-red-800">{error}</Card> : !flight || !seats ? <Card role="status">Loading cabin…</Card> :
      <SeatPicker key={`${id}:${user?.id ?? 'guest'}`} flight={flight} initialSeats={seats} user={user}
        onFlightChange={setFlight} onLogin={onLogin} onSessionExpired={onSessionExpired} onCheckout={onCheckout} onBooking={onBooking} onBookings={onBookings} onEntry={onEntry} />}
  </section>;
}
