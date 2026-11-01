import { useEffect, useState } from 'react';
import type { Flight, Hold, Payment, StartPaymentInput, User } from '../../shared/types.ts';
import { loadFlight, loadHold, loadPayment, releaseHold, startPayment } from './api.ts';
import { flightDate, flightTime, money } from './display.ts';
import { HoldSummary } from './HoldSummary.tsx';
import { PaymentDialog } from './PaymentDialog.tsx';
import { Button } from './components/ui/button.tsx';
import { Card } from './components/ui/card.tsx';
import { Input } from './components/ui/input.tsx';

type SavedPayment = StartPaymentInput & { key: string; paymentId?: string };

function readSavedPayment(key: string): SavedPayment | null {
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(key) ?? 'null');
    if (!value || typeof value !== 'object' || !('key' in value) || typeof value.key !== 'string' || !('outcome' in value)) return null;
    if (value.outcome !== 'SUCCESS' && value.outcome !== 'FAILURE' && value.outcome !== 'DELAYED_SUCCESS') return null;
    return {
      key: value.key, outcome: value.outcome,
      delaySeconds: 'delaySeconds' in value && typeof value.delaySeconds === 'number' ? value.delaySeconds : undefined,
      paymentId: 'paymentId' in value && typeof value.paymentId === 'string' ? value.paymentId : undefined,
      passengerName: 'passengerName' in value && typeof value.passengerName === 'string' ? value.passengerName : undefined,
      passengerAge: 'passengerAge' in value && typeof value.passengerAge === 'number' ? value.passengerAge : undefined,
    };
  } catch { return null; }
}

export function Checkout({ holdId, user, onLogin, onSessionExpired, onBooking, onCabin }: {
  holdId: string; user: User | null; onLogin: () => void; onSessionExpired: () => void;
  onBooking: (id: string) => void; onCabin: (id: string) => void;
}) {
  const storageKey = `flightsure:payment:${user?.id ?? 'guest'}:${holdId}`;
  const [saved, setSaved] = useState(() => readSavedPayment(storageKey));
  const [holdState, setHoldState] = useState<{ hold: Hold; serverTime: string; receivedAt: number } | null>(null);
  const [flight, setFlight] = useState<Flight | null>(null);
  const [paymentId, setPaymentId] = useState<string | null>(null);
  const [payment, setPayment] = useState<Payment | null>(null);
  const [passengerName, setPassengerName] = useState(saved?.passengerName ?? '');
  const [passengerAge, setPassengerAge] = useState(saved?.passengerAge === undefined ? '' : String(saved.passengerAge));
  const [showPayment, setShowPayment] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  function report(error: unknown) {
    setError(error instanceof Error ? error.message : 'Unable to load checkout.');
    if (error instanceof Error && 'status' in error && error.status === 401) {
      onSessionExpired(); onLogin();
    }
  }

  async function begin(pending: SavedPayment) {
    setBusy(true); setError('');
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(pending));
      setSaved(pending);
      const input: StartPaymentInput = {
        outcome: pending.outcome, passengerName: pending.passengerName, passengerAge: pending.passengerAge,
      };
      if (pending.outcome === 'DELAYED_SUCCESS') input.delaySeconds = pending.delaySeconds ?? 30;
      const next = await startPayment(holdId, input, pending.key);
      const remembered = { ...pending, paymentId: next.id };
      sessionStorage.setItem(storageKey, JSON.stringify(remembered));
      setSaved(remembered); setPaymentId(next.id);
      setHoldState(await loadHold(holdId));
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'PAYMENT_ALREADY_STARTED'
        && 'existingResourceId' in error && typeof error.existingResourceId === 'string') {
        setPaymentId(error.existingResourceId);
      } else {
        if (error instanceof Error && 'status' in error && typeof error.status === 'number'
          && error.status >= 400 && error.status < 500 && error.status !== 401) {
          sessionStorage.removeItem(storageKey); setSaved(null);
        }
        report(error);
      }
    } finally { setBusy(false); }
  }

  async function refreshHold() {
    try {
      const next = await loadHold(holdId);
      setHoldState(next); setFlight(await loadFlight(next.hold.flightId)); setError('');
    } catch (error) { report(error); }
  }

  useEffect(() => {
    if (!user || user.role !== 'PASSENGER') return;
    let active = true;
    async function restore() {
      try {
        const state = await loadHold(holdId);
        const details = await loadFlight(state.hold.flightId);
        if (!active) return;
        setHoldState(state); setFlight(details);
        if (state.hold.bookingId) { onBooking(state.hold.bookingId); return; }
        const remembered = readSavedPayment(storageKey);
        if (state.hold.paymentId || remembered?.paymentId) {
          setPaymentId(state.hold.paymentId ?? remembered?.paymentId ?? null);
        } else if (remembered) {
          await begin(remembered);
        }
      } catch (error) { if (active) report(error); }
    }
    void restore();
    return () => { active = false; };
    // This view is remounted for a different account or hold.
  }, [holdId, user?.id]);

  useEffect(() => {
    if (!paymentId || !user || user.role !== 'PASSENGER') return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function poll() {
      try {
        const next = await loadPayment(paymentId ?? '');
        if (!active) return;
        setPayment(next); setError('');
        if (next.status === 'SUCCEEDED' && next.bookingId) { onBooking(next.bookingId); return; }
        if (next.status !== 'PENDING') { await refreshHold(); return; }
      } catch (error) {
        if (!active) return;
        report(error);
        if (error instanceof Error && 'status' in error && (error.status === 401 || error.status === 404)) return;
      }
      if (active) timer = setTimeout(() => void poll(), 2000);
    }
    void poll();
    return () => { active = false; clearTimeout(timer); };
  }, [paymentId, user?.id]);

  function openPayment() {
    if (saved && !saved.paymentId) { void begin(saved); return; }
    if (!passengerName.trim() || !Number.isInteger(Number(passengerAge)) || Number(passengerAge) < 1 || Number(passengerAge) > 120) {
      setError('Enter the passenger’s full name and a whole-number age from 1 to 120.'); return;
    }
    setError(''); setShowPayment(true);
  }

  function pay(outcome: StartPaymentInput['outcome']) {
    setShowPayment(false);
    const pending: SavedPayment = {
      key: crypto.randomUUID(), outcome, passengerName: passengerName.trim(), passengerAge: Number(passengerAge),
    };
    void begin(pending);
  }

  async function release() {
    if (!holdState) return;
    setBusy(true);
    const keyName = `${storageKey}:release`;
    try {
      const key = sessionStorage.getItem(keyName) ?? crypto.randomUUID();
      sessionStorage.setItem(keyName, key);
      await releaseHold(holdId, key);
      sessionStorage.removeItem(keyName);
      setHoldState(await loadHold(holdId));
    } catch (error) { report(error); }
    finally { setBusy(false); }
  }

  if (!user) return <Card><h1 className="text-xl font-semibold">Log in to recover your checkout</h1><Button className="mt-4" onClick={onLogin}>Log in</Button></Card>;
  if (user.role !== 'PASSENGER') return <Card>Checkout is available to passenger accounts.</Card>;
  const canPay = holdState?.hold.status === 'ACTIVE' && !paymentId;
  return <section className="mx-auto max-w-3xl space-y-5">
    {flight && <Button variant="ghost" className="px-0" onClick={() => onCabin(flight.id)}>← Back to cabin</Button>}
    <h1 className="text-3xl font-semibold">Checkout</h1>
    {error && <Card role="alert" className="text-red-800">{error}<Button className="ml-3" variant="outline" onClick={() => void refreshHold()}>Refresh checkout</Button></Card>}
    {!holdState || !flight ? !error && <Card role="status">Loading checkout…</Card> : <>
      <Card>
        <p className="text-xs font-semibold tracking-widest text-primary">{flight.flightNumber} · {flightDate(flight.departureAt)}</p>
        <h2 className="mt-2 text-xl font-semibold">{flight.origin.name} → {flight.destination.name}</h2>
        <p className="mt-2 text-sm text-muted-foreground">Departure {flightTime(flight.departureAt)} IST · Seat {holdState.hold.seat.label}</p>
        <HoldSummary {...holdState} busy={busy} onRelease={() => void release()} onExpire={() => void refreshHold()} />
      </Card>
      <Card>
        <h2 className="text-xl font-semibold">{paymentId ? 'Payment status' : 'Passenger details'}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{paymentId ? 'We’ll confirm your booking after a successful payment.' : 'Enter the details of the person travelling in this seat.'}</p>
        {paymentId ? <div className="mt-5" aria-live="polite">
          <p className="font-semibold">{!payment || payment.status === 'PENDING' ? 'Payment processing…' : `Payment ${payment.status.toLowerCase()}`}</p>
          <p className="mt-2 text-sm">{payment?.reason ?? 'You can leave this page and return later. Processing continues on the server.'}</p>
          {payment && payment.status !== 'PENDING' && payment.status !== 'SUCCEEDED' && <Button className="mt-4" onClick={() => onCabin(flight.id)}>Choose a seat for a new attempt</Button>}
        </div> : canPay ? <form className="mt-5 space-y-4" onSubmit={(event) => { event.preventDefault(); openPayment(); }}>
          <div className="grid gap-4 sm:grid-cols-[1fr_120px]">
            <label className="block text-sm font-medium">Full name
              <Input className="mt-2" placeholder="Passenger’s full name" autoComplete="name" maxLength={100} required value={passengerName} disabled={busy || saved !== null} onChange={(event) => setPassengerName(event.target.value)} />
            </label>
            <label className="block text-sm font-medium">Age
              <Input className="mt-2" type="number" min={1} max={120} step={1} placeholder="Years" required value={passengerAge} disabled={busy || saved !== null} onChange={(event) => setPassengerAge(event.target.value)} />
            </label>
          </div>
          <Button type="submit" className="w-full" disabled={busy}>{busy ? 'Please wait…' : saved ? 'Retry the same payment request' : `Continue to payment · ${money(holdState.hold.quote.amountMinor)}`}</Button>
          <p className="text-xs text-muted-foreground">A demo card checkout opens next. No real payment is collected.</p>
        </form> : <p className="mt-4 text-sm">This hold is no longer active. Return to the cabin to choose a seat.</p>}
      </Card>
    </>}
    {showPayment && canPay && holdState && <PaymentDialog amount={holdState.hold.quote.amountMinor} passengerName={passengerName.trim()} onClose={() => setShowPayment(false)} onPay={pay} />}
  </section>;
}
