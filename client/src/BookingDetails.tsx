import { useEffect, useRef, useState } from 'react';
import type { Booking, User } from '../../shared/types.ts';
import { cancelBooking, loadBooking } from './api.ts';
import { flightDate, flightTime, money } from './display.ts';
import { AuthDialog } from './AuthDialog.tsx';
import { Button } from './components/ui/button.tsx';
import { Card } from './components/ui/card.tsx';
import { pollWhileVisible } from './polling.ts';

export function BookingDetails({
  id,
  user,
  onLogin,
  onSessionExpired,
  onBookings,
  onFlight,
}: {
  id: string;
  user: User | null;
  onLogin: () => void;
  onSessionExpired: () => void;
  onBookings: () => void;
  onFlight: (id: string) => void;
}) {
  const [booking, setBooking] = useState<Booking | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const refreshRequest = useRef<() => void>(() => {});
  const revision = useRef(0);
  const cancelling = useRef(false);

  function report(error: unknown) {
    setError(
      error instanceof Error ? error.message : 'Unable to load this booking.',
    );
    if (error instanceof Error && 'status' in error && error.status === 401) {
      onSessionExpired();
      onLogin();
    }
  }

  useEffect(() => {
    if (!user || user.role !== 'PASSENGER') return;
    let active = true;
    async function load() {
      if (cancelling.current) return;
      const version = revision.current;
      try {
        const next = await loadBooking(id);
        if (!active || version !== revision.current) return;
        setBooking(next); setError('');
      } catch (error) { if (active && version === revision.current) report(error); }
    }
    const polling = pollWhileVisible(load);
    refreshRequest.current = () => void polling.refresh();
    return () => {
      active = false; polling.stop();
    };
  }, [id, user?.id]);

  async function cancel() {
    if (!user) return;
    cancelling.current = true; revision.current += 1;
    setBusy(true);
    setError('');
    const storageKey = `flightsure:cancel:${user.id}:${id}`;
    try {
      const key = sessionStorage.getItem(storageKey) ?? crypto.randomUUID();
      sessionStorage.setItem(storageKey, key);
      setBooking(await cancelBooking(id, key));
      sessionStorage.removeItem(storageKey);
      setConfirming(false);
    } catch (error) {
      report(error);
      setConfirming(false);
    } finally {
      cancelling.current = false; revision.current += 1;
      setBusy(false);
    }
  }

  if (!user)
    return (
      <Card>
        <h1 className="text-xl font-semibold">Log in to view your booking</h1>
        <Button className="mt-4" onClick={onLogin}>
          Log in
        </Button>
      </Card>
    );
  if (user.role !== 'PASSENGER')
    return <Card>Bookings are available to passenger accounts.</Card>;
  const flight = booking?.currentFlight ?? booking?.originalFlight;
  const canCancel =
    booking?.status === 'UNASSIGNED' ||
    (booking?.status === 'CONFIRMED' &&
      booking.currentFlight &&
      new Date(booking.currentFlight.departureAt + '+05:30').getTime() >
        Date.now());
  return (
    <section className="mx-auto max-w-3xl space-y-5">
      <div className="flex items-center justify-between gap-3"><Button variant="ghost" className="px-0" onClick={onBookings}>← My bookings</Button><Button variant="outline" disabled={busy} onClick={() => refreshRequest.current()}>Refresh</Button></div>
      {error && (
        <Card role="alert" className="text-red-800">
          {error}
          <Button
            variant="outline"
            className="ml-3"
            onClick={() => refreshRequest.current()}
          >
            Refresh booking
          </Button>
        </Card>
      )}
      {!booking || !flight ? (
        !error && <Card role="status">Loading booking…</Card>
      ) : (
        <>
          <Card
            className={
              booking.status === 'CONFIRMED'
                ? 'border-emerald-200 bg-emerald-50'
                : ''
            }
          >
            <p className="text-xs font-semibold tracking-widest text-primary">
              BOOKING REFERENCE
            </p>
            <p className="mt-2 break-all text-3xl font-semibold tracking-wider">
              {booking.reference}
            </p>
            <h1 className="mt-4 text-xl font-semibold">
              {booking.status === 'CONFIRMED'
                ? booking.currentFlight?.id !== booking.originalFlight.id ? 'Replacement flight confirmed' : 'Booking confirmed'
                : booking.status === 'CANCELLED'
                  ? 'Booking cancelled'
                  : booking.status === 'REBOOKING' ? 'We’re finding another flight' : 'No replacement flight available'}
            </h1>
            <p className="mt-2 text-sm">
              {booking.status === 'CONFIRMED'
                ? booking.currentFlight?.id !== booking.originalFlight.id ? 'Your journey has moved to another flight. Your reference, passenger details and paid fare stay the same.' : 'Your seat is confirmed. You can find this journey in My bookings.'
                : booking.status === 'REBOOKING' ? 'Your flight was cancelled. We’re checking for a replacement within 24 hours of the original departure. This page updates automatically.'
                : booking.status === 'UNASSIGNED' ? 'No eligible replacement was available. Your booking and payment remain in history without a seat assignment. You can cancel this unassigned booking.'
                : booking.cancellationReason ?? 'Check this page for the latest booking status.'}
            </p>
            {(booking.status === 'REBOOKING' || booking.status === 'UNASSIGNED') && booking.cancellationReason && <p className="mt-3 text-sm text-muted-foreground">Cancellation reason: {booking.cancellationReason}</p>}
          </Card>
          <Card>
            <h2 className="text-xl font-semibold">
              {flight.origin.name} → {flight.destination.name}
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {flight.flightNumber} · {flightDate(flight.departureAt)}
            </p>
            <dl className="mt-6 grid grid-cols-2 gap-5 text-sm">
              {booking.passenger && (
                <>
                  <div>
                    <dt className="text-muted-foreground">Passenger</dt>
                    <dd className="mt-1 break-words font-semibold">
                      {booking.passenger.name}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Age</dt>
                    <dd className="mt-1 font-semibold">
                      {booking.passenger.age} years
                    </dd>
                  </div>
                </>
              )}
              <div>
                <dt className="text-muted-foreground">Departure</dt>
                <dd className="mt-1 font-semibold">
                  {flightTime(flight.departureAt)} IST
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Arrival</dt>
                <dd className="mt-1 font-semibold">
                  {flightTime(flight.arrivalAt)} IST
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Seat</dt>
                <dd className="mt-1 font-semibold">
                  {booking.seat?.label ?? 'No current seat assignment'}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Fare paid</dt>
                <dd className="mt-1 font-semibold">
                  {money(booking.farePaid.amountMinor)}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Confirmed</dt>
                <dd className="mt-1">
                  {flightDate(booking.confirmedAt)} ·{' '}
                  {flightTime(booking.confirmedAt)} IST
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Original flight</dt>
                <dd className="mt-1">
                  {booking.originalFlight.flightNumber} ·{' '}
                  {flightDate(booking.originalFlight.departureAt)} ·{' '}
                  {flightTime(booking.originalFlight.departureAt)} IST
                </dd>
              </div>
            </dl>
            <div className="mt-6 flex flex-wrap gap-3 border-t border-border pt-5">
              <Button variant="outline" onClick={() => onFlight(flight.id)}>
                View flight
              </Button>
              {canCancel && (
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => setConfirming(true)}
                >
                  Cancel booking
                </Button>
              )}
            </div>
          </Card>
        </>
      )}
      {confirming && (
        <AuthDialog
          label="Cancel booking"
          onClose={() => {
            if (!busy) setConfirming(false);
          }}
        >
          <Card>
            <h2 className="text-xl font-semibold">Cancel this booking?</h2>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              Your seat will be released. The booking and payment stay in your
              history. This demo does not simulate refunds or cancellation fees.
            </p>
            <div className="mt-5 flex flex-wrap justify-end gap-3">
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => setConfirming(false)}
              >
                Keep booking
              </Button>
              <Button
                className="bg-red-700 text-white hover:bg-red-800"
                disabled={busy}
                onClick={() => void cancel()}
              >
                {busy ? 'Cancelling…' : 'Confirm cancellation'}
              </Button>
            </div>
          </Card>
        </AuthDialog>
      )}
    </section>
  );
}
