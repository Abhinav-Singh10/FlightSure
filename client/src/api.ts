import type {
  Flight,
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
      error?: { message: string; fieldErrors?: { message: string }[] };
    } = await response.json();
    const detail = body.error?.fieldErrors?.[0]?.message;
    throw new Error(
      detail || body.error?.message || 'The request failed. Please try again.',
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
