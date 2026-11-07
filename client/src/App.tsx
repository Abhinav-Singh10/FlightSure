import { useEffect, useState } from 'react';
import type { Session } from '../../shared/types.ts';
import { loadSession, logout } from './api.ts';
import { AuthForm } from './AuthForm.tsx';
import { FlightSearch } from './FlightSearch.tsx';
import { FlightDetails } from './FlightDetails.tsx';
import { CabinView } from './CabinView.tsx';
import { AuthDialog } from './AuthDialog.tsx';
import { Checkout } from './Checkout.tsx';
import { BookingDetails } from './BookingDetails.tsx';
import { MyBookings } from './MyBookings.tsx';
import { WaitlistDetails } from './WaitlistDetails.tsx';
import { AdminPanel } from './AdminPanel.tsx';
import { Button } from './components/ui/button.tsx';
import { Card } from './components/ui/card.tsx';

function readView() {
  const query = new URLSearchParams(window.location.search);
  return {
    flightId: query.get('flight'),
    cabin: query.get('view') === 'seats',
    page: query.get('view') ?? 'search',
    holdId: query.get('hold'),
    bookingId: query.get('booking'),
    entryId: query.get('entry'),
    taskId: query.get('task'),
    tab: query.get('tab') === 'waitlist' ? 'waitlist' : query.get('tab') === 'messages' ? 'messages' : 'bookings',
  };
}

export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [authMode, setAuthMode] = useState<'register' | 'login' | null>(null);
  const [view, setView] = useState(readView);
  const { flightId } = view;
  const cabinOpen = view.cabin && flightId !== null;

  const checkoutOpen = view.page === 'checkout' && view.holdId !== null;
  const bookingOpen = view.page === 'booking' && view.bookingId !== null;
  const bookingsOpen = view.page === 'bookings';
  const waitlistOpen = view.page === 'waitlist' && view.entryId !== null;
  const adminOpen = view.page === 'admin';
  const focusedView = cabinOpen || checkoutOpen || bookingOpen || bookingsOpen || waitlistOpen || adminOpen;

  function navigate(query: URLSearchParams) {
    window.history.pushState(null, '', query.size ? `?${query}` : window.location.pathname);
    setView(readView());
  }

  function openCheckout(id: string) { navigate(new URLSearchParams({ view: 'checkout', hold: id })); }
  function openBooking(id: string) { navigate(new URLSearchParams({ view: 'booking', booking: id })); }
  function openBookings() { navigate(new URLSearchParams({ view: 'bookings' })); }
  function openTab(tab: string) { navigate(new URLSearchParams(tab === 'bookings' ? { view: 'bookings' } : { view: 'bookings', tab })); }
  function openEntry(id: string) { navigate(new URLSearchParams({ view: 'waitlist', entry: id })); }
  function openAdmin() { navigate(new URLSearchParams({ view: 'admin' })); }
  function openAdminFlight(id: string) { navigate(new URLSearchParams({ view: 'admin', flight: id })); }
  function openTask(id: string) { navigate(new URLSearchParams({ view: 'admin', task: id })); }

  function openFlight(id: string | null, cabin = false) {
    const query = new URLSearchParams();
    if (id) query.set('flight', id);
    if (id && cabin) query.set('view', 'seats');
    navigate(query);
  }
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(true);

  async function refreshSession() {
    setBusy(true);
    setError('');
    try {
      setSession(await loadSession());
    } catch {
      setError(
        'Unable to connect. Make sure the backend and database are running.',
      );
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void refreshSession();
  }, []);

  useEffect(() => {
    function handleBack() {
      setView(readView());
    }
    window.addEventListener('popstate', handleBack);
    return () => window.removeEventListener('popstate', handleBack);
  }, []);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [flightId, view.page, view.holdId, view.bookingId, view.entryId, view.tab, view.taskId]);

  async function signOut() {
    if (!session) return;
    setBusy(true);
    try {
      await logout();
      await refreshSession();
    } catch (error) {
      await refreshSession();
      setError(
        error instanceof Error
          ? error.message
          : 'Unable to log out. Try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  const accountForm =
    authMode && session && !session.authenticated ? (
      <AuthForm
        key={authMode}
        mode={authMode}
        onSuccess={(next) => {
          setSession(next);
          setAuthMode(null);
          if (next.user?.role === 'ADMIN' && view.page !== 'admin') openAdmin();
        }}
        onSwitch={() =>
          setAuthMode(authMode === 'login' ? 'register' : 'login')
        }
        onClose={() => setAuthMode(null)}
      />
    ) : null;

  return (
    <>
      <header className="border-b border-border bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-5 py-4 sm:px-8">
          <a
            href="/"
            aria-label="FlightSure home"
            className="flex items-center gap-3 text-xl font-bold tracking-tight"
          >
            <span
              aria-hidden="true"
              className="flex size-9 items-center justify-center rounded-xl bg-primary text-white"
            >
              ↗
            </span>
            FlightSure
          </a>
          <nav
            aria-label="Account"
            className="flex flex-wrap items-center gap-2 text-sm"
          >
            {session?.user ? (
              <>
                {session.user.role === 'PASSENGER' && <Button variant="ghost" disabled={busy} onClick={openBookings}>My bookings</Button>}
                {session.user.role === 'ADMIN' && <><Button variant="ghost" disabled={busy} onClick={openAdmin}>Admin</Button><Button variant="ghost" disabled={busy} onClick={() => openFlight(null)}>Flights</Button></>}
                <div className="mr-2 max-w-52 truncate">
                  <span className="block truncate font-medium">
                    {session.user.email}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {session.user.role === 'ADMIN'
                      ? 'Administrator'
                      : 'Passenger'}
                  </span>
                </div>
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => void signOut()}
                >
                  Log out
                </Button>
              </>
            ) : (
              <>
                <Button
                  variant="ghost"
                  disabled={busy || !session}
                  onClick={() => setAuthMode('login')}
                >
                  Log in
                </Button>
                <Button
                  disabled={busy || !session}
                  onClick={() => setAuthMode('register')}
                >
                  Create account
                </Button>
              </>
            )}
          </nav>
        </div>
      </header>

      <main
        className={
          cabinOpen
            ? 'mx-auto min-h-[calc(100vh-80px)] max-w-[1440px] px-4 pb-10 pt-5 sm:px-8'
            : 'mx-auto max-w-6xl px-5 pb-14 pt-10 sm:px-8 sm:pt-14'
        }
      >
        {!focusedView && (
          <div className="mb-9 max-w-2xl">
            <p className="mb-3 text-xs font-semibold tracking-[0.18em] text-primary">
              DELHI · BHOPAL · BANGALORE
            </p>
            <h1 className="text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">
              Your next journey,
              <br />
              <span className="text-primary">a little simpler.</span>
            </h1>
            <p className="mt-4 text-base leading-relaxed text-muted-foreground">
              Explore direct flights, compare schedules, and find the journey
              that fits your day.
            </p>
          </div>
        )}
        {error && (
          <div
            role="alert"
            className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"
          >
            {error}
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => void refreshSession()}
            >
              Retry connection
            </Button>
          </div>
        )}
        {cabinOpen && flightId && (
          <CabinView
            key={flightId}
            id={flightId}
            user={session?.user ?? null}
            onBack={() => openFlight(flightId)}
            onLogin={() => setAuthMode('login')}
            onSessionExpired={() => void refreshSession()}
            onCheckout={openCheckout} onBooking={openBooking} onBookings={openBookings} onEntry={openEntry}
          />
        )}
        {checkoutOpen && view.holdId && <Checkout key={`${view.holdId}:${session?.user?.id ?? 'guest'}`} holdId={view.holdId} user={session?.user ?? null}
          onLogin={() => setAuthMode('login')} onSessionExpired={() => void refreshSession()} onBooking={openBooking} onCabin={(id) => openFlight(id, true)} onEntry={openEntry} />}
        {bookingOpen && view.bookingId && <BookingDetails key={`${view.bookingId}:${session?.user?.id ?? 'guest'}`} id={view.bookingId} user={session?.user ?? null}
          onLogin={() => setAuthMode('login')} onSessionExpired={() => void refreshSession()} onBookings={openBookings} onFlight={openFlight} />}
        {bookingsOpen && <MyBookings key={`${session?.user?.id ?? 'guest'}:${view.tab}`} user={session?.user ?? null} tab={view.tab} onTab={openTab}
          onLogin={() => setAuthMode('login')} onSessionExpired={() => void refreshSession()} onOpen={openBooking} onEntry={openEntry} onSearch={() => openFlight(null)} />}
        {waitlistOpen && view.entryId && <WaitlistDetails key={`${view.entryId}:${session?.user?.id ?? 'guest'}`} id={view.entryId} user={session?.user ?? null}
          onLogin={() => setAuthMode('login')} onSessionExpired={() => void refreshSession()} onBack={() => openTab('waitlist')} onCheckout={openCheckout} onBooking={openBooking} onFlight={openFlight} />}
        {adminOpen && <AdminPanel key={`${session?.user?.id ?? 'guest'}:${flightId ?? ''}:${view.taskId ?? ''}`} user={session?.user ?? null} flightId={flightId} taskId={view.taskId}
          onSearch={openAdmin} onFlight={openAdminFlight} onTask={openTask} onCabin={(id) => openFlight(id, true)} onLogin={() => setAuthMode('login')}
          onSessionExpired={() => void refreshSession()} onEntry={openEntry} onBooking={openBooking} />}
        <div
          className={
            focusedView
              ? 'hidden'
              : 'grid items-start gap-7 lg:grid-cols-[minmax(0,1fr)_320px]'
          }
        >
          <div>
            <div hidden={flightId !== null}>
              <FlightSearch onOpen={openFlight} />
            </div>
            {flightId && !cabinOpen && !adminOpen && (
              <FlightDetails
                key={flightId}
                id={flightId}
                onBack={() => openFlight(null)}
                onViewSeats={() => openFlight(flightId, true)}
                user={session?.user ?? null} onLogin={() => setAuthMode('login')} onSessionExpired={() => void refreshSession()} onEntry={openEntry} onBooking={openBooking}
              />
            )}
          </div>
          <aside className={authMode ? 'order-first lg:order-last' : ''}>
            {!focusedView &&
              (accountForm || (
                <Card className="bg-[#edf4f0] shadow-none">
                  <div
                    aria-hidden="true"
                    className="mb-5 flex size-11 items-center justify-center rounded-full bg-white text-xl text-primary"
                  >
                    ↗
                  </div>
                  <h2 className="text-lg font-semibold">
                    Three cities. More possibilities.
                  </h2>
                  <p className="mt-3 text-sm leading-6 text-muted-foreground">
                    From a new beginning in Bangalore to a familiar welcome in
                    Delhi. Find a direct connection to what matters.
                  </p>
                  <div className="mt-6 space-y-4 border-t border-primary/15 pt-5 text-sm">
                    {['Delhi', 'Bhopal', 'Bangalore'].map((city) => (
                      <div key={city} className="flex justify-between">
                        <span>{city}</span>
                        <span aria-hidden="true" className="text-primary">
                          ↗
                        </span>
                      </div>
                    ))}
                  </div>
                </Card>
              ))}
          </aside>
        </div>
        {focusedView && accountForm && (
          <AuthDialog onClose={() => setAuthMode(null)}>
            {accountForm}
          </AuthDialog>
        )}
        <footer className="mt-10 border-t border-border pt-5 text-xs text-muted-foreground">
          All flight times are in Indian Standard Time (IST). Fares are in INR.
        </footer>
      </main>
    </>
  );
}
