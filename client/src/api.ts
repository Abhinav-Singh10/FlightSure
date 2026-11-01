import type {
  Flight,
  Hold,
  Pagination,
  SeatMap,
  Session,
} from '../../shared/types.ts';

async function request(path: string, options: RequestInit = {}) {
  const headers = new Headers(options.headers);
  if (options.body) headers.set('Content-Type', 'application/json');
  const response = await fetch(`/api${path}`, {
    ...options,
    headers,
    credentials: 'same-origin',
  });
  if (!response.ok) {
    if (!response.headers.get('Content-Type')?.includes('application/json')) {
      throw new Error('The backend is unavailable. Please try again shortly.');
    }
    const body: {
      error?: {
        message: string;
        code: string;
        existingResourceId: string | null;
        fieldErrors?: { message: string }[];
      };
    } = await response.json();
    const detail = body.error?.fieldErrors?.[0]?.message;
    throw Object.assign(
      new Error(
        detail ||
          body.error?.message ||
          'The request failed. Please try again.',
      ),
      {
        status: response.status,
        code: body.error?.code,
        existingResourceId: body.error?.existingResourceId,
      },
    );
  }
  return response;
}

export async function loadSession(): Promise<Session> {
  const response = await request('/auth/session');
  const body: { data: Session } = await response.json();
  return body.data;
}

export async function submitAuth(
  mode: 'register' | 'login',
  email: string,
  password: string,
) {
  const response = await request(`/auth/${mode}`, {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  const body: { data: Session } = await response.json();
  return body.data;
}

export async function logout() {
  await request('/auth/logout', { method: 'POST' });
}

export async function searchFlights(
  origin: string,
  destination: string,
  departureDate: string,
  page = 1,
) {
  const query = new URLSearchParams({
    origin,
    destination,
    departureDate,
    page: String(page),
  });
  const response = await request(`/flights?${query}`);
  const body: { data: Flight[]; pagination: Pagination } =
    await response.json();
  return { flights: body.data, pagination: body.pagination };
}

export async function loadFlight(id: string) {
  const response = await request(`/flights/${id}`);
  const body: { data: Flight } = await response.json();
  return body.data;
}

export async function loadSeats(id: string) {
  const response = await request(`/flights/${id}/seats`);
  const body: { data: SeatMap } = await response.json();
  return body.data;
}

export async function loadHold(id: string) {
  const response = await request(`/holds/${id}`);
  const body: { data: Hold; meta: { serverTime: string } } =
    await response.json();
  return {
    hold: body.data,
    serverTime: body.meta.serverTime,
    receivedAt: Date.now(),
  };
}

export async function createHold(
  flightId: string,
  seatId: string,
  key: string,
) {
  const response = await request('/holds', {
    method: 'POST',
    headers: { 'Idempotency-Key': key },
    body: JSON.stringify({ flightId, seatId }),
  });
  const body: { data: Hold; meta: { serverTime: string } } =
    await response.json();
  return {
    hold: body.data,
    serverTime: body.meta.serverTime,
    receivedAt: Date.now(),
  };
}

export async function releaseHold(id: string, key: string) {
  const response = await request(`/holds/${id}`, {
    method: 'DELETE',
    headers: { 'Idempotency-Key': key },
  });
  const body: { data: Hold; meta: { serverTime: string } } =
    await response.json();
  return {
    hold: body.data,
    serverTime: body.meta.serverTime,
    receivedAt: Date.now(),
  };
}
