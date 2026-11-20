import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import type { Flight, Hold, SeatMap, User } from '../../../shared/types.ts';
import { createHold, loadFlight, loadHold, loadSeats, releaseHold } from '../api.ts';
import { HoldSummary } from '../HoldSummary.tsx';
import { Button } from '../components/ui/button.tsx';
import { Card } from '../components/ui/card.tsx';
import { money } from '../display.ts';
import { JoinWaitlist } from '../JoinWaitlist.tsx';
import { ArrowLeftIcon, ArrowRightIcon, CheckIcon, CrossIcon, RefreshIcon, SeatIcon } from './CabinIcons.tsx';

// Vite includes this local image in both the development server and production build.
const cabinArtwork = new URL('./assets/cabin-shell.png', import.meta.url).href;

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
  const cabinScroll = useRef<HTMLDivElement>(null);

  function scrollCabin(direction: number) {
    const cabin = cabinScroll.current;
    if (cabin) cabin.scrollBy({ left: direction * cabin.clientWidth * 0.75 });
  }

  function save(value: SavedHold) {
    sessionStorage.setItem(storageKey, JSON.stringify(value));
    setSaved(value);
  }

  const refresh = useCallback(async () => {
    const [nextFlight, nextSeats] = await Promise.all([loadFlight(flight.id), loadSeats(flight.id)]);
    onFlightChange(nextFlight);
    setSeats(nextSeats);
    setSelected((previous) => nextSeats.seats.some((seat) => seat.id === previous && seat.status === 'AVAILABLE') ? previous : '');
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
  const rows = [...new Set(seats.seats.map((seat) => seat.row))].sort((a, b) => a - b);
  const selectedSeat = seats.seats.find((seat) => seat.id === selected);
  const seatLabel = selectedSeat?.label ?? bookedSeat?.label ?? (hasHold ? current?.hold.seat.label : undefined);
  const seatColumn = selectedSeat?.column ?? bookedSeat?.column ?? (hasHold ? seats.seats.find((seat) => seat.id === current?.hold.seat.id)?.column : undefined);
  const windowSeat = seatColumn === seats.layout.columns[0] || seatColumn === seats.layout.columns.at(-1);

  const selectionLocked = busy || hasHold || Boolean(bookedSeat) || !flight.bookable || Boolean(saved.createKey) || user?.role === 'ADMIN';
  const displayedFare = hasHold && current ? current.hold.quote.amountMinor : flight.fare.amountMinor;

  return <div className="cabin-workspace">
    <section className="cabin-canvas" aria-label="Aircraft cabin layout">
      <div className="cabin-toolbar">
        <div>
          <h2 className="font-bold">{seats.layout.aircraftName}</h2>
          <p className="mt-1 text-xs text-muted-foreground">{seats.seats.length} seats · {rows.length} rows · {flight.availableSeats} available</p>
        </div>
        <Button variant="ghost" disabled={busy} onClick={() => void refresh().catch(showError)}>
          <RefreshIcon className="size-4" />Refresh seats
        </Button>
      </div>
      <div className="cabin-scroll-controls">
        <p id="cabin-instructions">Choose a seat. Scroll sideways to see all rows.</p>
        <div className="flex gap-2">
          <Button variant="outline" className="w-11 px-0" aria-label="Scroll toward the front of the aircraft" aria-controls="aircraft-seat-scroll" onClick={() => scrollCabin(-1)}>
            <ArrowLeftIcon className="size-4" />
          </Button>
          <Button variant="outline" className="w-11 px-0" aria-label="Scroll toward the rear of the aircraft" aria-controls="aircraft-seat-scroll" onClick={() => scrollCabin(1)}>
            <ArrowRightIcon className="size-4" />
          </Button>
        </div>
      </div>
      <div id="aircraft-seat-scroll" className="aircraft-scroll" ref={cabinScroll} role="region" aria-label="Scrollable aircraft cabin" aria-describedby="cabin-instructions" tabIndex={0}>
        <div className="aircraft-stage">
          <img className="aircraft-artwork" src={cabinArtwork} alt="" width={2172} height={724} draggable={false} />
          <div className="cabin-seats">
            <div className="cabin-row cabin-column-labels" aria-hidden="true">
              {seats.layout.columns.map((column) => <Fragment key={column}>
                <span className="cabin-column">{column}</span>
                {seats.layout.aisleAfter.includes(column) && <span className="cabin-aisle">AISLE</span>}
              </Fragment>)}
            </div>
            {rows.map((row) => <div key={row} className="cabin-row">
              {seats.layout.columns.map((column) => {
                const seat = seats.seats.find((seat) => seat.row === row && seat.column === column);
                const chosen = selected === seat?.id;
                const yours = Boolean(seat?.isMine);
                const unavailable = seat?.status !== 'AVAILABLE' && !yours;
                const besideWindow = column === seats.layout.columns[0] || column === seats.layout.columns.at(-1);
                const state = chosen || yours ? 'selected' : unavailable ? 'unavailable' : 'available';
                return <Fragment key={column}>
                  {seat ? <button type="button"
                    aria-label={`Seat ${seat.label}, ${besideWindow ? 'window' : 'aisle'}, ${seat.status.toLowerCase()}${yours ? ' by you' : ''}`}
                    aria-pressed={chosen || yours}
                    title={`Seat ${seat.label} · ${yours ? 'Yours' : seat.status === 'AVAILABLE' ? 'Available' : 'Unavailable'}`}
                    disabled={selectionLocked || seat.status !== 'AVAILABLE'}
                    onClick={() => { setSelected(seat.id); setError(''); if (!hasHold) setCurrent(null); }}
                    data-state={state}
                    className="cabin-seat">
                    <span className="cabin-seat-cushion" aria-hidden="true">
                      {state === 'selected' && <CheckIcon className="cabin-seat-symbol" />}
                      {state === 'unavailable' && <CrossIcon className="cabin-seat-symbol" />}
                      <span className="cabin-seat-label">{seat.label}</span>
                    </span>
                  </button> : <span className="cabin-seat-space" />}
                  {seats.layout.aisleAfter.includes(column) && <span className="cabin-aisle" aria-label={`Row ${row}`}>{row}</span>}
                </Fragment>;
              })}
            </div>)}
          </div>
        </div>
      </div>
      <div className="cabin-legend" aria-label="Seat status legend">
        <span><i className="legend-seat" aria-hidden="true" />Available</span>
        <span><i className="legend-seat legend-selected" aria-hidden="true"><CheckIcon /></i>Selected / yours</span>
        <span><i className="legend-seat legend-unavailable" aria-hidden="true"><CrossIcon /></i>Unavailable</span>
      </div>
    </section>
    <aside className="cabin-selection" aria-label="Your seat selection">
      <Card className="p-5 sm:p-6">
        <div className="cabin-selection-top">
          <div className="flex min-w-0 items-center gap-4" aria-live="polite">
            <span className="selection-seat-icon"><SeatIcon className="size-7" /></span>
            <div>
              <h2 className="text-xl font-extrabold tracking-tight sm:text-2xl">{seatLabel ? `Seat ${seatLabel}` : 'Choose your seat'}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{seatLabel ? windowSeat ? 'Window seat' : 'Aisle seat' : 'Select an available seat in the cabin.'}</p>
            </div>
          </div>
          <div className="cabin-selection-fare">
            <p className="text-2xl font-extrabold tracking-tight">{money(displayedFare)}</p>
            <p className="mt-1 text-xs text-muted-foreground">Seat selection included</p>
          </div>
          <div className="cabin-selection-action">
            {!flight.bookable ? <p className="text-sm">This flight is not currently bookable.</p>
              : !user ? <Button className="w-full" onClick={onLogin}>Log in to hold a seat<ArrowRightIcon className="size-4" /></Button>
              : user.role === 'ADMIN' ? <p className="text-sm text-muted-foreground">Seat holds are available to passenger accounts.</p>
              : bookedSeat ? <Button className="w-full" variant="outline" onClick={onBookings}>View my booked seat {bookedSeat.label}</Button>
              : !hasHold && <Button className="w-full" disabled={busy || (!selected && !saved.createKey)} onClick={() => void submitHold()}>
                {busy ? 'Please wait…' : saved.createKey ? 'Retry seat hold' : selected ? `Hold seat ${selectedSeat?.label}` : 'Select a seat to continue'}
                <ArrowRightIcon className="size-4" />
              </Button>}
          </div>
        </div>
        {error && <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
        {flight.bookable && flight.availableSeats === 0 && !hasHold && <p className="mt-4 text-sm">All seats are currently unavailable. Refresh to check for released seats.</p>}
        {existingBookingId && <Button variant="outline" className="mt-4" onClick={() => { if (existingBookingId) onBooking(existingBookingId); }}>View existing booking</Button>}
        {flight.bookable && flight.availableSeats === 0 && !hasHold && !bookedSeat && <div className="mt-4"><JoinWaitlist flightId={flight.id} user={user} onLogin={onLogin} onSessionExpired={onSessionExpired} onEntry={onEntry} onBooking={onBooking} onCabin={() => void refresh().catch(showError)} /></div>}
        {current && <HoldSummary {...current} busy={busy} onRelease={() => current.hold.waitlistEntryId ? onEntry(current.hold.waitlistEntryId) : void release()} onExpire={() => void refresh().catch(showError)}
          checkoutLabel={current.hold.waitlistEntryId ? 'View seat offer' : undefined}
          releaseLabel={current.hold.waitlistEntryId ? 'Manage offer' : undefined}
          onCheckout={() => current.hold.waitlistEntryId ? onEntry(current.hold.waitlistEntryId) : onCheckout(current.hold.id)} onBooking={onBooking} />}
        {!hasHold && !bookedSeat && <p className="mt-4 text-xs leading-5 text-muted-foreground">Selecting a seat does not reserve it. A successful hold reserves it for up to five minutes.</p>}
      </Card>
    </aside>
  </div>;
}
