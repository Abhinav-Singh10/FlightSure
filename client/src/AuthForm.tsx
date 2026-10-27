import { useState } from 'react';
import type { SubmitEvent } from 'react';
import type { Session } from '../../shared/types.ts';
import { submitAuth } from './api.ts';
import { Button } from './components/ui/button.tsx';
import { Input } from './components/ui/input.tsx';
import { Card } from './components/ui/card.tsx';

type AuthFormProps = {
  mode: 'register' | 'login';
  onSuccess: (session: Session) => void;
  onSwitch: () => void;
  onClose: () => void;
};

export function AuthForm({
  mode,
  onSuccess,
  onSwitch,
  onClose,
}: AuthFormProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const registering = mode === 'register';

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    if (new TextEncoder().encode(password).length > 72) {
      setError('Your password is too long. Use at most 72 UTF-8 bytes.');
      return;
    }
    setBusy(true);
    try {
      onSuccess(await submitAuth(mode, email, password));
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : 'Unable to sign in. Try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="border-primary/20">
      <div className="mb-5 flex items-start justify-between gap-3">
        <div>
          <p className="mb-1 text-xs font-semibold tracking-widest text-primary">
            YOUR FLIGHTSURE ACCOUNT
          </p>
          <h2 className="text-xl font-semibold">
            {registering ? 'A new journey starts here.' : 'Welcome back.'}
          </h2>
        </div>
        <Button
          variant="ghost"
          className="min-h-8 px-2"
          onClick={onClose}
          aria-label="Close account form"
        >
          ×
        </Button>
      </div>
      <form onSubmit={submit} className="space-y-4">
        <label className="block text-sm font-medium">
          Email address
          <Input
            className="mt-2"
            name="email"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            required
            maxLength={254}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        <label className="block text-sm font-medium">
          Password
          <Input
            className="mt-2"
            name="password"
            type="password"
            autoComplete={registering ? 'new-password' : 'current-password'}
            required
            minLength={registering ? 8 : 1}
            maxLength={72}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        {registering && (
          <p className="text-xs text-muted-foreground">
            Choose a password with at least 8 characters.
          </p>
        )}
        {error && (
          <p
            role="alert"
            className="rounded-lg bg-red-50 p-3 text-sm text-red-800"
          >
            {error}
          </p>
        )}
        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? 'Please wait…' : registering ? 'Create account' : 'Log in'}
        </Button>
      </form>
      <p className="mt-5 text-center text-sm text-muted-foreground">
        {registering ? 'Already have an account?' : 'New to FlightSure?'}{' '}
        <button
          onClick={onSwitch}
          className="font-semibold text-primary underline-offset-4 hover:underline"
        >
          {registering ? 'Log in' : 'Create account'}
        </button>
      </p>
    </Card>
  );
}
