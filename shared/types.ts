export type User = {
  id: string;
  email: string;
  role: 'PASSENGER' | 'ADMIN';
};

export type Session = {
  authenticated: boolean;
  user: User | null;
  expiresAt: string | null;
};

export type Money = { amountMinor: number; currency: 'INR' };
export type SeatRef = { id: string; label: string };

export type Hold = {
  id: string;
  flightId: string;
  seat: SeatRef;
  source: 'DIRECT' | 'WAITLIST';
  status: 'ACTIVE' | 'PAYMENT_PENDING' | 'CONSUMED' | 'RELEASED' | 'EXPIRED' | 'FAILED';
  expiresAt: string;
  quote: Money;
  waitlistEntryId: string | null;
  paymentId: string | null;
  bookingId: string | null;
};

export type Airport = {
  code: 'DEL' | 'BHO' | 'BLR';
  name: 'Delhi' | 'Bhopal' | 'Bangalore';
};

export type Flight = {
  id: string;
  flightNumber: string;
  origin: Airport;
  destination: Airport;
  departureAt: string;
  arrivalAt: string;
  status: 'SCHEDULED' | 'CANCELLED' | 'DEPARTED';
  fare: Money;
  availableSeats: number;
  bookable: boolean;
};

export type Pagination = { page: number; limit: number; total: number };

export type SeatMap = {
  flightId: string;
  layout: { aircraftName: string; columns: string[]; aisleAfter: string[] };
  seats: {
    id: string;
    label: string;
    row: number;
    column: string;
    status: 'AVAILABLE' | 'HELD' | 'BOOKED';
    isMine: boolean;
  }[];
};
