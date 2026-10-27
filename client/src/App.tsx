import { useEffect, useState } from 'react';
import type { Session } from '../../shared/types.ts';
import { loadSession, logout } from './api.ts';
import { AuthForm } from './AuthForm.tsx';
import { FlightSearch } from './FlightSearch.tsx';
import { FlightDetails } from './FlightDetails.tsx';
import { Button } from './components/ui/button.tsx';
import { Card } from './components/ui/card.tsx';

export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [authMode, setAuthMode] = useState<'register' | 'login' | null>(null);
  const [flightId, setFlightId] = useState<string | null>(null);
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

      <main className="mx-auto max-w-6xl px-5 pb-14 pt-10 sm:px-8 sm:pt-14">
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
            Explore direct flights, compare schedules, and find the journey that
            fits your day.
          </p>
        </div>
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
        <div className="grid items-start gap-7 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div>
            <div hidden={flightId !== null}>
              <FlightSearch onOpen={setFlightId} />
            </div>
            {flightId && (
              <FlightDetails
                key={flightId}
                id={flightId}
                onBack={() => setFlightId(null)}
              />
            )}
          </div>
          <aside className={authMode ? 'order-first lg:order-last' : ''}>
            {authMode && session && !session.authenticated ? (
              <AuthForm
                key={authMode}
                mode={authMode}
                onSuccess={(next) => {
                  setSession(next);
                  setAuthMode(null);
                }}
                onSwitch={() =>
                  setAuthMode(authMode === 'login' ? 'register' : 'login')
                }
                onClose={() => setAuthMode(null)}
              />
            ) : (
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
            )}
          </aside>
        </div>
        <footer className="mt-10 border-t border-border pt-5 text-xs text-muted-foreground">
          All flight times are in Indian Standard Time (IST). Fares are in INR.
        </footer>
      </main>
    </>
  );
}
