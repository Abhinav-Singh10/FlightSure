import { useEffect, useState } from 'react';
import type { Hold } from '../../shared/types.ts';
import { money } from './display.ts';
import { Button } from './components/ui/button.tsx';

function secondsLeft(expiresAt: string, serverTime: string, receivedAt: number) {
  const deadline = new Date(expiresAt + '+05:30').getTime();
  const serverNow = new Date(serverTime + '+05:30').getTime() + Date.now() - receivedAt;
  return Math.max(0, Math.ceil((deadline - serverNow) / 1000));
}

export function HoldSummary({ hold, serverTime, receivedAt, busy, onRelease, onExpire, onCheckout, onBooking, checkoutLabel, releaseLabel }: {
  hold: Hold; serverTime: string; receivedAt: number; busy: boolean;
  onRelease: () => void; onExpire: () => void; onCheckout?: () => void; onBooking?: (id: string) => void;
  checkoutLabel?: string;
  releaseLabel?: string;
}) {
  const [seconds, setSeconds] = useState(() => secondsLeft(hold.expiresAt, serverTime, receivedAt));
  useEffect(() => {
    setSeconds(secondsLeft(hold.expiresAt, serverTime, receivedAt));
    if (hold.status !== 'ACTIVE' && hold.status !== 'PAYMENT_PENDING') return;
    const timer = setInterval(() => {
      const remaining = secondsLeft(hold.expiresAt, serverTime, receivedAt);
      setSeconds(remaining);
      if (remaining === 0) { clearInterval(timer); onExpire(); }
    }, 1000);
    return () => clearInterval(timer);
  }, [hold.expiresAt, hold.status, serverTime, receivedAt, onExpire]);

  const active = hold.status === 'ACTIVE' && seconds > 0;
  const pending = hold.status === 'PAYMENT_PENDING';
  return <div className="mt-6 rounded-xl border border-primary/25 bg-emerald-50 p-5">
    <h3 className="font-semibold" aria-live="polite">{active ? `Seat ${hold.seat.label} is held for you` : pending ? 'Payment processing' : `Seat ${hold.seat.label} · ${hold.status === 'ACTIVE' ? 'EXPIRED' : hold.status}`}</h3>
    <p className="mt-2 text-sm">Saved fare: {money(hold.quote.amountMinor)}</p>
    {active || pending ? <>
      <p className="mt-2 text-sm">Hold time remaining: <strong className="tabular-nums">{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}</strong></p>
      <p className="mt-1 text-xs text-muted-foreground">{pending && seconds === 0 ? 'The hold deadline has passed. Check the payment outcome.' : `Expires at ${hold.expiresAt.slice(11, 19)} IST. A hold is not a confirmed booking.`}</p>
      {onCheckout && <Button className="mt-4 w-full" disabled={busy} onClick={onCheckout}>{checkoutLabel ?? (pending ? 'View payment' : 'Continue to checkout')}</Button>}
      {active && <Button variant="outline" className="mt-3" disabled={busy} onClick={onRelease}>{busy ? 'Please wait…' : releaseLabel ?? 'Release seat'}</Button>}
    </> : <>
      <p className="mt-2 text-sm">{hold.status === 'EXPIRED' ? 'Your hold expired. Choose an available seat to try again.' : hold.status === 'RELEASED' ? 'Your seat has been released.' : hold.status === 'CONSUMED' ? 'This hold has become a booking.' : `Hold status: ${hold.status}.`}</p>
      {hold.paymentId && !hold.bookingId && onCheckout && <Button className="mt-4" onClick={onCheckout}>View payment</Button>}
      {hold.bookingId && onBooking && <Button className="mt-4" onClick={() => { if (hold.bookingId) onBooking(hold.bookingId); }}>View booking</Button>}
    </>}
  </div>;
}
