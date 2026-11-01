import { useEffect, useRef, useState } from 'react';
import type { Flight, User, WaitlistEntry } from '../../shared/types.ts';
import { acceptOffer, loadFlight, loadWaitlistEntry, withdrawWaitlist } from './api.ts';
import { flightDate, flightTime } from './display.ts';
import { pollWhileVisible } from './polling.ts';
import { HoldSummary } from './HoldSummary.tsx';
import { Button } from './components/ui/button.tsx';
import { Card } from './components/ui/card.tsx';

export function WaitlistDetails({ id, user, onLogin, onSessionExpired, onBack, onCheckout, onBooking, onFlight }: {
  id: string; user: User | null; onLogin: () => void; onSessionExpired: () => void; onBack: () => void;
  onCheckout: (id: string) => void; onBooking: (id: string) => void; onFlight: (id: string) => void;
}) {
  const [state, setState] = useState<{ entry: WaitlistEntry; serverTime: string; receivedAt: number } | null>(null);
  const [flight, setFlight] = useState<Flight | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const refresh = useRef<() => void>(() => {});
  const changing = useRef(false);
  const revision = useRef(0);

  function report(error: unknown) {
    setError(error instanceof Error ? error.message : 'Unable to load your waitlist entry.');
    if (error instanceof Error && 'status' in error && error.status === 401) { onSessionExpired(); onLogin(); }
  }

  useEffect(() => {
    if (!user || user.role !== 'PASSENGER') return;
    let active = true;
    async function load() {
      if (changing.current) return;
      const version = revision.current;
      setRefreshing(true);
      try {
        const next = await loadWaitlistEntry(id);
        const details = await loadFlight(next.entry.flightId);
        if (!active || version !== revision.current) return;
        setState(next); setFlight(details); setError('');
      } catch (error) { if (active && version === revision.current) report(error); }
      finally { if (active) setRefreshing(false); }
    }
    const polling = pollWhileVisible(load);
    refresh.current = () => void polling.refresh();
    return () => { active = false; polling.stop(); };
  }, [id, user?.id]);

  async function act(action: 'accept' | 'withdraw') {
    if (!user) return;
    changing.current = true; revision.current += 1;
    setBusy(true); setError('');
    const keyName = `flightsure:waitlist:${user.id}:${id}:${action}`;
    try {
      const key = sessionStorage.getItem(keyName) ?? crypto.randomUUID();
      sessionStorage.setItem(keyName, key);
      if (action === 'accept') await acceptOffer(id, key);
      else await withdrawWaitlist(id, key);
      const next = await loadWaitlistEntry(id);
      setState(next); sessionStorage.removeItem(keyName);
      if (action === 'accept' && next.entry.offerHold && next.entry.status === 'OFFERED') onCheckout(next.entry.offerHold.id);
    } catch (error) {
      report(error);
      if (error instanceof Error && 'status' in error && typeof error.status === 'number' && error.status >= 400 && error.status < 500 && error.status !== 401) sessionStorage.removeItem(keyName);
    } finally { changing.current = false; revision.current += 1; setBusy(false); }
  }

  if (!user) return <Card><h1 className="text-xl font-semibold">Log in to view your waitlist entry</h1><Button className="mt-4" onClick={onLogin}>Log in</Button></Card>;
  if (user.role !== 'PASSENGER') return <Card>Waitlists are available to passenger accounts.</Card>;
  const entry = state?.entry;
  const hold = entry?.offerHold;
  const liveOffer = entry?.status === 'OFFERED' && hold?.status === 'ACTIVE';
  return <section className="mx-auto max-w-3xl space-y-5">
    <div className="flex items-center justify-between gap-3"><Button variant="ghost" className="px-0" onClick={onBack}>← My waitlist</Button><Button variant="outline" disabled={refreshing} onClick={() => refresh.current()}>Refresh</Button></div>
    <h1 className="text-3xl font-semibold">{entry?.status === 'OFFERED' ? 'Your seat offer' : 'Waitlist details'}</h1>
    {error && <Card role="alert" className="text-red-800">{error}</Card>}
    {!entry || !flight ? !error && <Card role="status">Loading waitlist entry…</Card> : <Card>
      <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-xl font-semibold">{flight.origin.name} → {flight.destination.name}</h2><span className="rounded-full bg-muted px-3 py-1 text-xs font-semibold">{entry.status}</span></div>
      <p className="mt-2 text-sm text-muted-foreground">{flight.flightNumber} · {flightDate(flight.departureAt)} · {flightTime(flight.departureAt)} IST</p>
      <p className="mt-3 text-sm">{entry.status === 'WAITING' ? 'You’re in the queue. This does not reserve a seat or charge you.' : entry.status === 'OFFERED' ? entry.acceptedAt ? 'You accepted this offer. Complete checkout before the hold expires.' : 'A seat is reserved temporarily for you. Accept the offer to continue to checkout.' : entry.status === 'FULFILLED' ? 'This offer became a confirmed booking.' : 'This entry is no longer active. Joining again creates a new place in the queue.'}</p>
      {hold && state && <HoldSummary hold={hold} serverTime={state.serverTime} receivedAt={state.receivedAt} busy={busy} onRelease={() => void act('withdraw')} onExpire={() => refresh.current()}
        releaseLabel="Decline offer"
        onCheckout={entry.acceptedAt || hold.paymentId ? () => onCheckout(hold.id) : undefined} onBooking={onBooking} />}
      <div className="mt-5 flex flex-wrap gap-3">
        {liveOffer && !entry.acceptedAt && <Button disabled={busy} onClick={() => void act('accept')}>{busy ? 'Please wait…' : 'Accept and continue'}</Button>}
        {entry.status === 'WAITING' && <Button variant="outline" disabled={busy} onClick={() => void act('withdraw')}>Leave waitlist</Button>}
        {liveOffer && <p className="self-center text-xs text-muted-foreground">{entry.acceptedAt ? 'Acceptance keeps the original deadline.' : 'Declining passes the seat to the next passenger.'}</p>}
        {entry.bookingId && !hold?.bookingId && <Button onClick={() => { if (entry.bookingId) onBooking(entry.bookingId); }}>View booking</Button>}
        <Button variant="outline" onClick={() => onFlight(flight.id)}>View flight</Button>
      </div>
    </Card>}
  </section>;
}
