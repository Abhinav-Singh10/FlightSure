import { useEffect, useRef, useState } from 'react';
import type { Booking, Flight, Notification, Pagination, User, WaitlistEntry } from '../../shared/types.ts';
import { loadBookings, loadFlight, loadNotifications, loadWaitlist } from './api.ts';
import { flightDate, flightTime, money } from './display.ts';
import { pollWhileVisible } from './polling.ts';
import { Button } from './components/ui/button.tsx';
import { Card } from './components/ui/card.tsx';

export function MyBookings({ tab, user, onTab, onLogin, onSessionExpired, onOpen, onEntry, onSearch }: {
  tab: string; user: User | null; onTab: (tab: string) => void; onLogin: () => void; onSessionExpired: () => void;
  onOpen: (id: string) => void; onEntry: (id: string) => void; onSearch: () => void;
}) {
  const [page, setPage] = useState(1);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [entries, setEntries] = useState<{ entry: WaitlistEntry; flight: Flight }[]>([]);
  const [messages, setMessages] = useState<Notification[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [busy, setBusy] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const refresh = useRef<() => void>(() => {});

  useEffect(() => {
    if (!user || user.role !== 'PASSENGER') return;
    let active = true;
    setBusy(true);
    async function load() {
      setRefreshing(true);
      try {
        if (tab === 'waitlist') {
          const next = await loadWaitlist(page);
          const rows = await Promise.all(next.data.map(async (entry) => ({ entry, flight: await loadFlight(entry.flightId) })));
          if (!active) return;
          setEntries(rows); setPagination(next.pagination);
        } else if (tab === 'messages') {
          const next = await loadNotifications(page);
          if (!active) return;
          setMessages(next.data); setPagination(next.pagination);
        } else {
          const next = await loadBookings(page);
          if (!active) return;
          setBookings(next.data); setPagination(next.pagination);
        }
        setError('');
      } catch (error) {
        if (!active) return;
        setError(error instanceof Error ? error.message : 'Unable to load your journeys.');
        if (error instanceof Error && 'status' in error && error.status === 401) { onSessionExpired(); onLogin(); }
      } finally { if (active) { setBusy(false); setRefreshing(false); } }
    }
    const polling = pollWhileVisible(load, tab === 'waitlist' || tab === 'messages');
    refresh.current = () => void polling.refresh();
    return () => { active = false; polling.stop(); };
  }, [page, tab, user?.id]);

  if (!user) return <Card><h1 className="text-xl font-semibold">Log in to view your journeys</h1><Button className="mt-4" onClick={onLogin}>Log in</Button></Card>;
  if (user.role !== 'PASSENGER') return <Card>Bookings and waitlists are available to passenger accounts.</Card>;
  const empty = tab === 'waitlist' ? entries.length === 0 : tab === 'messages' ? messages.length === 0 : bookings.length === 0;
  return <section className="mx-auto max-w-4xl space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><h1 className="text-3xl font-semibold">My bookings</h1><Button variant="outline" onClick={onSearch}>Find a flight</Button></div>
    <nav className="flex flex-wrap gap-2 border-b border-border pb-4" aria-label="My journeys">
      {['bookings', 'waitlist', 'messages'].map((name) => <Button key={name} variant={tab === name ? 'default' : 'ghost'} aria-current={tab === name ? 'page' : undefined} onClick={() => onTab(name)}>{name[0].toUpperCase() + name.slice(1)}</Button>)}
    </nav>
    <div className="flex items-center justify-between gap-3"><p className="text-sm text-muted-foreground">{tab === 'waitlist' ? 'Your waiting entries and seat offers.' : tab === 'messages' ? 'Seat offers and journey updates.' : 'Your confirmed and cancelled journeys.'}</p><Button variant="outline" disabled={refreshing} onClick={() => refresh.current()}>{refreshing ? 'Refreshing…' : 'Refresh'}</Button></div>
    {error && <Card role="alert" className="text-red-800">{error}</Card>}
    {busy ? <Card role="status">Loading…</Card> : !error && <>
      {empty && <Card className="py-10 text-center"><h2 className="font-semibold">{tab === 'waitlist' ? 'No waitlist entries yet' : tab === 'messages' ? 'No messages yet' : 'No bookings yet'}</h2><p className="mt-2 text-sm text-muted-foreground">{tab === 'waitlist' ? 'When a flight is full, you can join its waitlist.' : tab === 'messages' ? 'New seat offers will appear here.' : 'Choose a flight to start your next journey.'}</p></Card>}
      {tab === 'bookings' && bookings.map((booking) => {
        const flight = booking.currentFlight ?? booking.originalFlight;
        return <Card key={booking.id}>
          <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-semibold tracking-wider">{booking.reference}</p><span className="rounded-full bg-muted px-3 py-1 text-xs font-semibold">{booking.status}</span></div>
          <h2 className="mt-4 text-xl font-semibold">{flight.origin.name} → {flight.destination.name}</h2>
          <p className="mt-2 text-sm text-muted-foreground">{flightDate(flight.departureAt)} · {flightTime(flight.departureAt)} IST · {booking.seat ? `Seat ${booking.seat.label}` : 'No current seat assignment'}</p>
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3"><p className="font-semibold">{money(booking.farePaid.amountMinor)}</p><Button variant="outline" onClick={() => onOpen(booking.id)}>View booking</Button></div>
        </Card>;
      })}
      {tab === 'waitlist' && entries.map(({ entry, flight }) => <Card key={entry.id}>
        <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-xl font-semibold">{flight.origin.name} → {flight.destination.name}</h2><span className="rounded-full bg-muted px-3 py-1 text-xs font-semibold">{entry.status}</span></div>
        <p className="mt-2 text-sm text-muted-foreground">{flight.flightNumber} · {flightDate(flight.departureAt)} · {flightTime(flight.departureAt)} IST</p>
        <p className="mt-3 text-sm">{entry.status === 'WAITING' ? 'We’ll offer you a seat when one becomes available.' : entry.status === 'OFFERED' ? `Seat ${entry.offerHold?.seat.label} is offered to you. Open the offer to check its deadline.` : `Joined ${flightDate(entry.joinedAt)} at ${flightTime(entry.joinedAt)} IST`}</p>
        <Button className="mt-4" variant="outline" onClick={() => onEntry(entry.id)}>{entry.status === 'OFFERED' ? 'View seat offer' : 'View waitlist entry'}</Button>
      </Card>)}
      {tab === 'messages' && messages.map((message) => <Card key={message.id}>
        <p className="text-xs font-semibold tracking-wide text-primary">{message.type.replaceAll('_', ' ')}</p>
        <p className="mt-3 text-sm leading-6">{message.message}</p>
        <p className="mt-2 text-xs text-muted-foreground">{flightDate(message.createdAt)} · {flightTime(message.createdAt)} IST</p>
        {message.waitlistEntryId ? <Button className="mt-4" variant="outline" onClick={() => { if (message.waitlistEntryId) onEntry(message.waitlistEntryId); }}>View offer</Button> : message.bookingId && <Button className="mt-4" variant="outline" onClick={() => { if (message.bookingId) onOpen(message.bookingId); }}>View booking</Button>}
      </Card>)}
    </>}
    {pagination && pagination.total > pagination.limit && <div className="flex items-center justify-end gap-3 text-sm"><Button variant="outline" disabled={refreshing || page === 1} onClick={() => setPage(page - 1)}>Previous</Button><span>Page {page}</span><Button variant="outline" disabled={refreshing || page * pagination.limit >= pagination.total} onClick={() => setPage(page + 1)}>Next</Button></div>}
  </section>;
}
