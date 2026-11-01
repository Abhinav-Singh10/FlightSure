import { Fragment, useCallback, useEffect, useState } from 'react';
import type { Flight, Hold, SeatMap, User } from '../../shared/types.ts';
import { createHold, loadFlight, loadHold, loadSeats, releaseHold } from './api.ts';
import { HoldSummary } from './HoldSummary.tsx';
import { Button } from './components/ui/button.tsx';
import { Card } from './components/ui/card.tsx';
import { money } from './display.ts';
import { JoinWaitlist } from './JoinWaitlist.tsx';

type SavedHold = { holdId?: string; createKey?: string; seatId?: string; releaseKey?: string };

function readSaved(key: string): SavedHold {
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(key) ?? '{}');
    if (!value || typeof value !== 'object') return {};
    return {
      holdId: 'holdId' in value && typeof value.holdId === 'string' ? value.holdId : undefined,
      createKey: 'createKey' in value && typeof value.createKey === 'string' ? value.createKey : undefined,
      seatId: 'seatId' in value && typeof value.seatId === 'string' ? value.seatId : undefined,
      releaseKey: 'releaseKey' in value && typeof value.releaseKey === 'string' ? value.releaseKey : undefined,
    };
  } catch { return {}; }
}

export function SeatPicker({ flight, initialSeats, user, onFlightChange, onLogin, onSessionExpired, onCheckout, onBooking, onBookings, onEntry }: {
  flight: Flight; initialSeats: SeatMap; user: User | null;
  onFlightChange: (flight: Flight) => void; onLogin: () => void; onSessionExpired: () => void;
  onCheckout: (id: string) => void; onBooking: (id: string) => void; onBookings: () => void;
  onEntry: (id: string) => void;
}) {
  const storageKey = `flightsure:hold:${user?.id ?? 'anonymous'}:${flight.id}`;
  const [saved, setSaved] = useState(() => readSaved(storageKey));
  const [seats, setSeats] = useState(initialSeats);
  const [selected, setSelected] = useState('');
  const [current, setCurrent] = useState<{ hold: Hold; serverTime: string; receivedAt: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [existingBookingId, setExistingBookingId] = useState<string | null>(null);

  function save(value: SavedHold) {
    sessionStorage.setItem(storageKey, JSON.stringify(value));
    setSaved(value);
  }

  const refresh = useCallback(async () => {
    const [nextFlight, nextSeats] = await Promise.all([loadFlight(flight.id), loadSeats(flight.id)]);
    onFlightChange(nextFlight);
    setSeats(nextSeats);
    const remembered = readSaved(storageKey);
    if (user && remembered.holdId) {
      setCurrent(await loadHold(remembered.holdId));
    }
  }, [flight.id, storageKey, user, onFlightChange]);

  function showError(error: unknown) {
    setError(error instanceof Error ? error.message : 'Unable to update your seat.');
    if (error instanceof Error && 'status' in error && error.status === 401) onSessionExpired();
  }

  // Keep the same request key after a lost response. The server safely replays it.
  async function submitHold(remembered = saved) {
    if (!user) { onLogin(); return; }
    if (!selected && !remembered.seatId) return;
    setBusy(true);
    setError('');
    const pending = { createKey: remembered.createKey ?? crypto.randomUUID(), seatId: remembered.seatId ?? selected };
    try {
      save(pending);
      const result = await createHold(flight.id, pending.seatId, pending.createKey);
      save({ holdId: result.hold.id });
      // A replay can describe an earlier state; GET supplies the current one.
      setCurrent(await loadHold(result.hold.id));
      setSelected('');
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ALREADY_BOOKED' && 'existingResourceId' in error && typeof error.existingResourceId === 'string') {
        save({}); setSelected(''); setExistingBookingId(error.existingResourceId);
      } else if (error instanceof Error && 'code' in error && error.code === 'ACTIVE_HOLD_EXISTS' && 'existingResourceId' in error && typeof error.existingResourceId === 'string') {
        save({ holdId: error.existingResourceId });
      } else if (error instanceof Error && 'status' in error && typeof error.status === 'number' && error.status >= 400 && error.status < 500 && error.status !== 401) {
        save({});
        setSelected('');
      }
      showError(error);
    } finally {
      try { await refresh(); } catch (error) { showError(error); }
      setBusy(false);
    }
  }

  async function release(remembered = saved) {
    if (!remembered.holdId) return;
    setBusy(true);
    setError('');
    const pending = { holdId: remembered.holdId, releaseKey: remembered.releaseKey ?? crypto.randomUUID() };
    try {
      save(pending);
      await releaseHold(pending.holdId, pending.releaseKey);
      save({ holdId: pending.holdId });
      setCurrent(await loadHold(pending.holdId));
    } catch (error) { showError(error); }
    finally {
      try { await refresh(); } catch (error) { showError(error); }
      setBusy(false);
    }
  }

  useEffect(() => {
    let active = true;
    let refreshing = false;
    async function poll() {
      if (refreshing || !active) return;
      refreshing = true;
      try { await refresh(); }
      catch (error) { if (active) showError(error); }
      finally { refreshing = false; }
    }
    // Restore an interrupted submission once when this account opens the cabin.
    const remembered = readSaved(storageKey);
    if (user && remembered.createKey && remembered.seatId) void submitHold(remembered);
    else if (user && remembered.releaseKey) void release(remembered);
    else void poll();
    const timer = setInterval(() => void poll(), 5000);
    return () => { active = false; clearInterval(timer); };
    // The parent remounts this component when the account or flight changes.
  }, [storageKey]);

  const hasHold = current?.hold.status === 'ACTIVE' || current?.hold.status === 'PAYMENT_PENDING';
  const bookedSeat = seats.seats.find((seat) => seat.status === 'BOOKED' && seat.isMine);
  const rows = [...new Set(seats.seats.map((seat) => seat.row))];
  const selectedSeat = seats.seats.find((seat) => seat.id === selected);
  const seatLabel = selectedSeat?.label ?? bookedSeat?.label ?? (hasHold ? current?.hold.seat.label : undefined);
  const seatColumn = selectedSeat?.column ?? bookedSeat?.column ?? (hasHold ? seats.seats.find((seat) => seat.id === current?.hold.seat.id)?.column : undefined);
  const windowSeat = seatColumn === seats.layout.columns[0] || seatColumn === seats.layout.columns.at(-1);

  return <div className="cabin-workspace">
    <section className="cabin-canvas" aria-label="Aircraft cabin layout">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4 sm:px-7">
        <div><h2 className="font-semibold">{seats.layout.aircraftName}</h2><p className="mt-1 text-xs text-muted-foreground">{seats.seats.length} seats · {rows.length} rows · {flight.availableSeats} available</p></div>
        <Button variant="ghost" disabled={busy} onClick={() => void refresh().catch(showError)}>↻ Refresh seats</Button>
      </div>
      <div className="aircraft-stage">
        <svg className="aircraft-wings" viewBox="0 0 760 600" preserveAspectRatio="none" aria-hidden="true">
          <path d="M310 200 L205 245 L42 365 Q30 378 52 380 L264 328 L310 350 Z" />
          <path d="M450 200 L555 245 L718 365 Q730 378 708 380 L496 328 L450 350 Z" />
        </svg>
        <svg className="aircraft-tail-wings" viewBox="0 0 760 200" preserveAspectRatio="none" aria-hidden="true">
          <path d="M330 20 L220 120 L220 142 L350 110 Z" />
          <path d="M430 20 L540 120 L540 142 L410 110 Z" />
        </svg>
        <div className="aircraft-body">
          <div className="aircraft-cockpit" aria-hidden="true"><span /><span /></div>
          <p className="aircraft-front">FRONT OF AIRCRAFT <span aria-hidden="true">↑</span></p>
          <div className="cabin-door-row" aria-hidden="true"><span>EXIT</span><span>EXIT</span></div>
          <div className="cabin-row cabin-column-labels" aria-hidden="true">
            <span className="cabin-window-space" />
            {seats.layout.columns.map((column) => <Fragment key={column}>
              <span className="cabin-column">{column}</span>
              {seats.layout.aisleAfter.includes(column) && <span className="cabin-aisle">AISLE</span>}
            </Fragment>)}
            <span className="cabin-window-space" />
          </div>
          {rows.map((row) => <div key={row} className="cabin-row">
            <span className="cabin-window" aria-hidden="true" />
            {seats.layout.columns.map((column) => {
              const seat = seats.seats.find((seat) => seat.row === row && seat.column === column);
              const chosen = selected === seat?.id;
              const besideWindow = column === seats.layout.columns[0] || column === seats.layout.columns.at(-1);
              return <Fragment key={column}>
                {seat ? <button type="button"
                  aria-label={`Seat ${seat.label}, ${besideWindow ? 'window' : 'aisle'}, ${seat.status.toLowerCase()}${seat.isMine ? ' by you' : ''}`}
                  aria-pressed={chosen}
                  disabled={busy || hasHold || Boolean(bookedSeat) || !flight.bookable || seat.status !== 'AVAILABLE' || Boolean(saved.createKey) || user?.role === 'ADMIN'}
                  onClick={() => { setSelected(seat.id); setError(''); if (!hasHold) setCurrent(null); }}
                  className={`cabin-seat ${chosen || seat.isMine ? 'cabin-seat-selected' : seat.status !== 'AVAILABLE' ? 'cabin-seat-unavailable' : ''}`}>
                  {seat.label}
                </button> : <span className="cabin-seat-space" />}
                {seats.layout.aisleAfter.includes(column) && <span className="cabin-aisle" aria-label={`Row ${row}`}>{row}</span>}
              </Fragment>;
            })}
            <span className="cabin-window" aria-hidden="true" />
          </div>)}
          <div className="cabin-door-row cabin-rear-exits" aria-hidden="true"><span>EXIT</span><span>EXIT</span></div>
          <p className="aircraft-rear">REAR OF AIRCRAFT</p>
          <div className="aircraft-tail" aria-hidden="true" />
        </div>
      </div>
      <div className="cabin-legend" aria-label="Seat status legend">
        <span><i className="legend-seat" />Available</span>
        <span><i className="legend-seat legend-selected" />Selected / yours</span>
        <span><i className="legend-seat legend-unavailable" />Unavailable</span>
        <span><i className="legend-window" />Window</span>
      </div>
    </section>
    <aside className="cabin-selection" aria-label="Your seat selection">
      <Card className="p-5 sm:p-6">
        <p className="text-xs font-semibold tracking-widest text-primary">ONE PASSENGER</p>
        <h2 className="mt-2 text-xl font-semibold">Your selection</h2>
        <p className="mt-2 break-all text-sm text-muted-foreground">{user?.email ?? 'Choose a seat, then log in to hold it.'}</p>
        <div className="my-6 flex items-center gap-4 rounded-xl bg-muted/70 p-4">
          <div className="flex size-14 shrink-0 items-center justify-center rounded-xl border border-primary/20 bg-white text-xl font-semibold text-primary">{seatLabel ?? '—'}</div>
          <div><p className="font-semibold">{seatLabel ? `Seat ${seatLabel}` : 'Find your favourite spot'}</p><p className="mt-1 text-xs text-muted-foreground">{seatLabel ? windowSeat ? 'Window seat · enjoy the view' : 'Aisle seat · easy access' : 'Select an available seat in the cabin.'}</p></div>
        </div>
        <dl className="space-y-3 border-b border-border pb-5 text-sm">
          <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Flight fare</dt><dd className="font-semibold">{money(flight.fare.amountMinor)}</dd></div>
          <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Seat selection</dt><dd className="text-primary">Included</dd></div>
          <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Temporary hold</dt><dd>Up to 5 minutes</dd></div>
        </dl>
        {error && <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
        <div className="mt-5">
          {!flight.bookable ? <p className="text-sm">This flight is not currently bookable.</p> : !user ? <Button className="w-full" onClick={onLogin}>Log in to hold a seat</Button> : user.role === 'ADMIN' ? <p className="text-sm text-muted-foreground">Seat holds are available to passenger accounts.</p> : bookedSeat ? <Button className="w-full" variant="outline" onClick={onBookings}>View my booked seat {bookedSeat.label}</Button> : !hasHold && <Button className="w-full" disabled={busy || (!selected && !saved.createKey)} onClick={() => void submitHold()}>{busy ? 'Please wait…' : saved.createKey ? 'Retry seat hold' : selected ? `Hold seat ${selectedSeat?.label}` : 'Select a seat to continue'}</Button>}
        </div>
        {flight.bookable && flight.availableSeats === 0 && !hasHold && <p className="mt-3 text-sm">All seats are currently unavailable. Refresh to check for released seats.</p>}
        {existingBookingId && <Button variant="outline" className="mt-3 w-full" onClick={() => { if (existingBookingId) onBooking(existingBookingId); }}>View existing booking</Button>}
        {flight.bookable && flight.availableSeats === 0 && !hasHold && !bookedSeat && <div className="mt-4"><JoinWaitlist flightId={flight.id} user={user} onLogin={onLogin} onSessionExpired={onSessionExpired} onEntry={onEntry} onBooking={onBooking} onCabin={() => void refresh().catch(showError)} /></div>}
        {current && <HoldSummary {...current} busy={busy} onRelease={() => current.hold.waitlistEntryId ? onEntry(current.hold.waitlistEntryId) : void release()} onExpire={() => void refresh().catch(showError)}
          checkoutLabel={current.hold.waitlistEntryId ? 'View seat offer' : undefined}
          releaseLabel={current.hold.waitlistEntryId ? 'Manage offer' : undefined}
          onCheckout={() => current.hold.waitlistEntryId ? onEntry(current.hold.waitlistEntryId) : onCheckout(current.hold.id)} onBooking={onBooking} />}
        {!hasHold && !bookedSeat && <p className="mt-4 text-xs leading-5 text-muted-foreground">Selecting a seat does not reserve it. Your seat is reserved temporarily only after the hold succeeds.</p>}
      </Card>
      <div className="mt-4 rounded-xl border border-border px-5 py-4 text-xs leading-6 text-muted-foreground">
        <p className="font-semibold text-foreground">A little help choosing</p>
        <p>Columns {seats.layout.columns[0]} and {seats.layout.columns.at(-1)} are beside the windows. The space down the middle is the aisle.</p>
      </div>
    </aside>
    {selectedSeat && !hasHold && !bookedSeat && <div className="cabin-mobile-action">
      <div><p className="text-xs text-muted-foreground">Your selection</p><p className="font-semibold">Seat {selectedSeat.label} · {money(flight.fare.amountMinor)}</p></div>
      <Button disabled={busy || !flight.bookable} onClick={() => user ? void submitHold() : onLogin()}>{busy ? 'Please wait…' : user ? `Hold seat ${selectedSeat.label}` : 'Log in to hold'}</Button>
    </div>}
  </div>;
}
