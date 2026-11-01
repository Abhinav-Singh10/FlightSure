import { useEffect, useState } from 'react';
import type { Booking, Pagination, User } from '../../shared/types.ts';
import { loadBookings } from './api.ts';
import { flightDate, flightTime, money } from './display.ts';
import { Button } from './components/ui/button.tsx';
import { Card } from './components/ui/card.tsx';

export function MyBookings({ user, onLogin, onSessionExpired, onOpen, onSearch }: {
  user: User | null; onLogin: () => void; onSessionExpired: () => void;
  onOpen: (id: string) => void; onSearch: () => void;
}) {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ data: Booking[]; pagination: Pagination } | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!user || user.role !== 'PASSENGER') return;
    let active = true;
    setBusy(true); setError('');
    loadBookings(page).then((next) => { if (active) setData(next); })
      .catch((error: unknown) => {
        if (!active) return;
        setError(error instanceof Error ? error.message : 'Unable to load bookings.');
        if (error instanceof Error && 'status' in error && error.status === 401) { onSessionExpired(); onLogin(); }
      }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [page, user?.id, retry]);
  if (!user) return <Card><h1 className="text-xl font-semibold">Log in to view your bookings</h1><Button className="mt-4" onClick={onLogin}>Log in</Button></Card>;
  if (user.role !== 'PASSENGER') return <Card>Bookings are available to passenger accounts.</Card>;
  return <section className="mx-auto max-w-4xl space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><h1 className="text-3xl font-semibold">My bookings</h1><Button variant="outline" onClick={onSearch}>Find a flight</Button></div>
    <p className="text-sm text-muted-foreground">Your confirmed and cancelled journeys, all in one place.</p>
    {error && <Card role="alert" className="text-red-800">{error}<Button className="ml-3" variant="outline" onClick={() => setRetry(retry + 1)}>Try again</Button></Card>}
    {busy ? <Card role="status">Loading bookings…</Card> : !error && data?.data.length === 0 ? <Card className="py-10 text-center"><h2 className="font-semibold">No bookings yet</h2><p className="mt-2 text-sm text-muted-foreground">Choose a flight and complete simulated payment to confirm your first journey.</p><Button className="mt-5" onClick={onSearch}>Search flights</Button></Card> : !error && data?.data.map((booking) => {
      const flight = booking.currentFlight ?? booking.originalFlight;
      return <Card key={booking.id}>
        <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-semibold tracking-wider">{booking.reference}</p><span className="rounded-full bg-muted px-3 py-1 text-xs font-semibold">{booking.status}</span></div>
        <h2 className="mt-4 text-xl font-semibold">{flight.origin.name} → {flight.destination.name}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{flightDate(flight.departureAt)} · {flightTime(flight.departureAt)} IST · {booking.seat ? `Seat ${booking.seat.label}` : 'No current seat assignment'}</p>
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3"><p className="font-semibold">{money(booking.farePaid.amountMinor)}</p><Button variant="outline" onClick={() => onOpen(booking.id)}>View booking</Button></div>
      </Card>;
    })}
    {data && data.pagination.total > data.pagination.limit && <div className="flex items-center justify-end gap-3 text-sm"><Button variant="outline" disabled={busy || page === 1} onClick={() => setPage(page - 1)}>Previous</Button><span>Page {page}</span><Button variant="outline" disabled={busy || page * data.pagination.limit >= data.pagination.total} onClick={() => setPage(page + 1)}>Next</Button></div>}
  </section>;
}
