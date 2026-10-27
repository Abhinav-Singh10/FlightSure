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
  fare: { amountMinor: number; currency: 'INR' };
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
