import { useState } from 'react';
import type { User } from '../../shared/types.ts';
import { joinWaitlist, loadHold, loadWaitlistEntry } from './api.ts';
import { Button } from './components/ui/button.tsx';

export function JoinWaitlist({ flightId, user, onLogin, onSessionExpired, onEntry, onBooking, onCabin }: {
  flightId: string; user: User | null; onLogin: () => void; onSessionExpired: () => void;
  onEntry: (id: string) => void; onBooking: (id: string) => void; onCabin: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [existingId, setExistingId] = useState<string | null>(null);
  const [existingKind, setExistingKind] = useState('');
  const keyName = `flightsure:join-waitlist:${user?.id ?? 'guest'}:${flightId}`;

  async function join() {
    if (!user) { onLogin(); return; }
    setBusy(true); setError(''); setExistingId(null);
    try {
      const key = sessionStorage.getItem(keyName) ?? crypto.randomUUID();
      sessionStorage.setItem(keyName, key);
      const entry = await joinWaitlist(flightId, key);
      // Replays describe the original operation; read today's state before navigation.
      const current = await loadWaitlistEntry(entry.id);
      sessionStorage.removeItem(keyName);
      onEntry(current.entry.id);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Unable to join the waitlist.');
      if (error instanceof Error && 'status' in error && error.status === 401) { onSessionExpired(); onLogin(); }
      if (error instanceof Error && 'code' in error && typeof error.code === 'string') {
        setExistingKind(error.code);
        if ('existingResourceId' in error && typeof error.existingResourceId === 'string') setExistingId(error.existingResourceId);
      }
      if (error instanceof Error && 'status' in error && typeof error.status === 'number' && error.status >= 400 && error.status < 500 && error.status !== 401) sessionStorage.removeItem(keyName);
    } finally { setBusy(false); }
  }

  async function openExisting() {
    if (!existingId) return;
    if (existingKind === 'WAITLIST_ENTRY_EXISTS') onEntry(existingId);
    else if (existingKind === 'ALREADY_BOOKED') onBooking(existingId);
    else {
      try {
        const { hold } = await loadHold(existingId);
        if (hold.waitlistEntryId) onEntry(hold.waitlistEntryId);
        else onCabin();
      } catch (error) { setError(error instanceof Error ? error.message : 'Unable to open your hold.'); }
    }
  }

  if (user?.role === 'ADMIN') return null;
  return <div className="space-y-3">
    <Button variant="outline" disabled={busy} onClick={() => void join()}>{busy ? 'Please wait…' : user ? 'Join waitlist' : 'Log in to join waitlist'}</Button>
    {error && <p role="alert" className="text-sm text-red-800">{error}</p>}
    {existingId && <Button variant="outline" onClick={() => void openExisting()}>View existing {existingKind === 'ALREADY_BOOKED' ? 'booking' : existingKind === 'WAITLIST_ENTRY_EXISTS' ? 'entry' : 'hold'}</Button>}
    {existingKind === 'SEATS_AVAILABLE' && <Button variant="outline" onClick={onCabin}>Choose a seat</Button>}
  </div>;
}
