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

export type StartPaymentInput = {
  outcome: 'SUCCESS' | 'FAILURE' | 'DELAYED_SUCCESS';
  delaySeconds?: number;
  passengerName?: string;
  passengerAge?: number;
};

export type Payment = {
  id: string;
  holdId: string;
  status: 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'VOIDED';
  amount: Money;
  bookingId: string | null;
  reason: string | null;
  createdAt: string;
  completedAt: string | null;
};

export type Booking = {
  id: string;
  reference: string;
  status: 'CONFIRMED' | 'CANCELLED' | 'REBOOKING' | 'UNASSIGNED';
  originalFlight: Flight;
  currentFlight: Flight | null;
  seat: SeatRef | null;
  farePaid: Money;
  paymentId: string;
  confirmedAt: string;
  cancellationReason: string | null;
  passenger: { name: string; age: number } | null;
};

export type WaitlistEntry = {
  id: string;
  flightId: string;
  status: 'WAITING' | 'OFFERED' | 'FULFILLED' | 'WITHDRAWN' | 'EXPIRED' | 'CLOSED';
  joinedAt: string;
  offerHold: Hold | null;
  acceptedAt: string | null;
  bookingId: string | null;
};

export type OfferAcceptance = { waitlistEntry: WaitlistEntry; hold: Hold };

export type Notification = {
  id: string;
  type: 'WAITLIST_OFFER' | 'FLIGHT_CANCELLED' | 'REBOOKED' | 'NO_ALTERNATIVE';
  message: string;
  flightId: string;
  bookingId: string | null;
  waitlistEntryId: string | null;
  createdAt: string;
};

export type CancellationTask = {
  id: string;
  flightId: string;
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';
  affectedCount: number;
  processedCount: number;
  rebookedCount: number;
  unassignedCount: number;
  createdAt: string;
  completedAt: string | null;
  error: string | null;
};
