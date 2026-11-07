import { useEffect, useRef, useState } from 'react';
import type { CancellationTask, Flight, User } from '../../shared/types.ts';
import { cancelFlight, loadCancellation, loadFlight } from './api.ts';
import { pollWhileVisible } from './polling.ts';
import { FlightSearch } from './FlightSearch.tsx';
import { FlightDetails } from './FlightDetails.tsx';
import { AuthDialog } from './AuthDialog.tsx';
import { flightDate, flightTime } from './display.ts';
import { Button } from './components/ui/button.tsx';
import { Card } from './components/ui/card.tsx';
import { Input } from './components/ui/input.tsx';

type SavedCancellation = {
  flightId: string;
  reason: string;
  key: string;
  taskId?: string;
};

function readSaved(key: string): SavedCancellation | null {
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(key) ?? 'null');
    if (!value || typeof value !== 'object'
      || !('flightId' in value) || typeof value.flightId !== 'string'
      || !('reason' in value) || typeof value.reason !== 'string'
      || !('key' in value) || typeof value.key !== 'string') return null;
    return {
      flightId: value.flightId,
      reason: value.reason,
      key: value.key,
      taskId: 'taskId' in value && typeof value.taskId === 'string' ? value.taskId : undefined,
    };
  } catch {
    return null;
  }
}

export function AdminPanel({
  user, flightId, taskId, onSearch, onFlight, onTask, onCabin,
  onLogin, onSessionExpired, onEntry, onBooking,
}: {
  user: User | null;
  flightId: string | null;
  taskId: string | null;
  onSearch: () => void;
  onFlight: (id: string) => void;
  onTask: (id: string) => void;
  onCabin: (id: string) => void;
  onLogin: () => void;
  onSessionExpired: () => void;
  onEntry: (id: string) => void;
  onBooking: (id: string) => void;
}) {
  const storageKey = `flightsure:admin-cancellation:${user?.id ?? 'guest'}`;
  const [saved, setSaved] = useState(() => readSaved(storageKey));
  const [reason, setReason] = useState(saved?.flightId === flightId ? saved.reason : '');
  const [flight, setFlight] = useState<Flight | null>(null);
  const [task, setTask] = useState<CancellationTask | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const refresh = useRef<() => void>(() => {});
  const uncertain = Boolean(saved && !saved.taskId && saved.flightId === flightId);
  const pendingRequest = saved && !saved.taskId && !taskId
    && (!flightId || saved.flightId === flightId) ? saved : null;

  function report(error: unknown) {
    setError(error instanceof Error ? error.message : 'Unable to load the admin page.');
    if (error instanceof Error && 'status' in error && error.status === 401) {
      onSessionExpired();
      onLogin();
    }
  }

  async function submit(pending: SavedCancellation) {
    setBusy(true);
    setError('');
    setConfirming(false);
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(pending));
      setSaved(pending);
      const result = await cancelFlight(pending.flightId, pending.reason, pending.key);
      const remembered = { ...pending, taskId: result.id };
      sessionStorage.setItem(storageKey, JSON.stringify(remembered));
      setSaved(remembered);
      onTask(result.id);
    } catch (error) {
      report(error);
      if (error instanceof Error && 'status' in error && typeof error.status === 'number'
        && error.status >= 400 && error.status < 500 && error.status !== 401) {
        sessionStorage.removeItem(storageKey);
        setSaved(null);
      }
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!user || user.role !== 'ADMIN') return;
    const remembered = readSaved(storageKey);
    if (!taskId && remembered && (!flightId || remembered.flightId === flightId)) {
      if (!remembered.taskId) {
        void submit(remembered);
      } else if (flightId) {
        onTask(remembered.taskId);
        return;
      }
    }
    let active = true;
    async function load() {
      setRefreshing(true);
      try {
        if (taskId) {
          const next = await loadCancellation(taskId);
          const details = await loadFlight(next.flightId);
          if (!active) return;
          setTask(next);
          setFlight(details);
          if (next.status === 'COMPLETED') polling.stop();
        } else if (flightId) {
          const details = await loadFlight(flightId);
          if (!active) return;
          setFlight(details);
        }
        if (active) setError('');
      } catch (error) {
        if (!active) return;
        report(error);
        if (error instanceof Error && 'status' in error
          && (error.status === 401 || error.status === 403 || error.status === 404)) {
          polling.stop();
        }
      } finally {
        if (active) setRefreshing(false);
      }
    }
    const polling = pollWhileVisible(load, Boolean(taskId), 2000);
    refresh.current = () => void polling.refresh();
    return () => {
      active = false;
      polling.stop();
    };
  }, [flightId, taskId, user?.id]);

  function confirm() {
    if (!flightId) return;
    if (saved && uncertain) {
      void submit(saved);
      return;
    }
    if (!reason.trim()) {
      setError('Enter a cancellation reason.');
      return;
    }
    setConfirming(true);
  }

  if (!user) return (
    <Card>
      <h1 className="text-xl font-semibold">Log in as an administrator</h1>
      <Button className="mt-4" onClick={onLogin}>Log in</Button>
    </Card>
  );
  if (user.role !== 'ADMIN') return <Card>This page is available to administrators.</Card>;

  return (
    <section className="mx-auto max-w-4xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold tracking-widest text-primary">FLIGHTSURE ADMIN</p>
          <h1 className="mt-2 text-3xl font-semibold">
            {taskId ? 'Cancellation progress' : 'Manage flights'}
          </h1>
        </div>
        {(flightId || taskId) && (
          <Button variant="outline" onClick={onSearch}>Find another flight</Button>
        )}
      </div>
      {error && (
        <Card role="alert" className="text-red-800">
          {error}
          {pendingRequest && (
            <Button className="ml-3" variant="outline" disabled={busy} onClick={() => void submit(pendingRequest)}>
              Retry the same cancellation request
            </Button>
          )}
          {(taskId || flightId) && (
            <Button className="ml-3" variant="outline" disabled={refreshing} onClick={() => refresh.current()}>
              Refresh
            </Button>
          )}
        </Card>
      )}
      {!flightId && !taskId && (
        <>
          {saved?.taskId && (
            <Button variant="outline" onClick={() => { if (saved.taskId) onTask(saved.taskId); }}>
              Resume last cancellation
            </Button>
          )}
          <FlightSearch onOpen={onFlight} />
        </>
      )}
      {flightId && !taskId && (
        <>
          <FlightDetails
            id={flightId} user={user} onBack={onSearch}
            onViewSeats={() => onCabin(flightId)} onLogin={onLogin}
            onSessionExpired={onSessionExpired} onEntry={onEntry} onBooking={onBooking}
          />
          {!flight && !error && <Card role="status">Loading cancellation controls…</Card>}
          {flight && (
            <Card>
              <h2 className="text-xl font-semibold">Cancel this departure</h2>
              {flight.bookable ? (
                <form className="mt-4 space-y-4" onSubmit={(event) => { event.preventDefault(); confirm(); }}>
                  <label className="block text-sm font-medium">
                    Cancellation reason
                    <Input
                      className="mt-2" maxLength={300} required value={reason}
                      disabled={busy || uncertain}
                      onChange={(event) => setReason(event.target.value)}
                      placeholder="For example, aircraft unavailable"
                    />
                  </label>
                  <Button className="bg-red-700 text-white hover:bg-red-800" type="submit" disabled={busy}>
                    {busy ? 'Please wait…' : uncertain ? 'Retry the same cancellation request' : 'Cancel flight'}
                  </Button>
                </form>
              ) : <p className="mt-3 text-sm">This flight is cancelled or has already departed.</p>}
            </Card>
          )}
        </>
      )}
      {taskId && (!task || !flight ? (
        !error && <Card role="status">Loading recovery progress…</Card>
      ) : (
        <>
          <Card>
            <p className="text-xs font-semibold tracking-widest text-primary">{flight.flightNumber} · CANCELLED</p>
            <h2 className="mt-2 text-xl font-semibold">{flight.origin.name} → {flight.destination.name}</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {flightDate(flight.departureAt)} · {flightTime(flight.departureAt)} IST
            </p>
          </Card>
          <Card aria-live="polite">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-xl font-semibold">
                {task.status === 'COMPLETED' ? 'Recovery completed'
                  : task.status === 'FAILED' ? 'Recovery will retry' : 'Finding replacement flights'}
              </h2>
              <span className="rounded-full bg-muted px-3 py-1 text-xs font-semibold">{task.status}</span>
            </div>
            <dl className="mt-6 grid grid-cols-2 gap-5 sm:grid-cols-4">
              {[
                { label: 'Affected', count: task.affectedCount },
                { label: 'Processed', count: task.processedCount },
                { label: 'Rebooked', count: task.rebookedCount },
                { label: 'Unassigned', count: task.unassignedCount },
              ].map((item) => (
                <div key={item.label}>
                  <dt className="text-sm text-muted-foreground">{item.label}</dt>
                  <dd className="mt-1 text-3xl font-semibold">{item.count}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-5 text-sm">
              {task.error ?? (task.status === 'COMPLETED'
                ? 'Every affected booking has a replacement or an unassigned outcome. Passengers can view their messages and bookings.'
                : 'Processing continues on the server, including after logout.')}
            </p>
            {task.completedAt && (
              <p className="mt-3 text-xs text-muted-foreground">
                Completed {flightDate(task.completedAt)} · {flightTime(task.completedAt)} IST
              </p>
            )}
          </Card>
        </>
      ))}
      {confirming && flight && (
        <AuthDialog label="Confirm flight cancellation" onClose={() => setConfirming(false)}>
          <Card>
            <h2 className="text-xl font-semibold">Cancel {flight.flightNumber}?</h2>
            <p className="mt-3 text-sm leading-6">
              Confirmed passengers will be considered for automatic rebooking. Unpaid holds and the waitlist will close. This flight stays in history.
            </p>
            <p className="mt-3 break-words text-sm text-muted-foreground">Reason: {reason.trim()}</p>
            <div className="mt-5 flex flex-wrap justify-end gap-3">
              <Button variant="outline" onClick={() => setConfirming(false)}>Keep flight</Button>
              <Button
                className="bg-red-700 text-white hover:bg-red-800"
                onClick={() => {
                  if (flightId) void submit({ flightId, reason: reason.trim(), key: crypto.randomUUID() });
                }}
              >
                Confirm cancellation
              </Button>
            </div>
          </Card>
        </AuthDialog>
      )}
    </section>
  );
}
