CREATE TABLE payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hold_id uuid NOT NULL UNIQUE REFERENCES holds (id),
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'SUCCEEDED', 'FAILED', 'VOIDED')),
  amount_paise integer NOT NULL CHECK (amount_paise > 0),
  requested_outcome text NOT NULL CHECK (requested_outcome IN ('SUCCESS', 'FAILURE', 'DELAYED_SUCCESS')),
  delay_seconds integer,
  created_at timestamptz NOT NULL,
  due_at timestamptz NOT NULL CHECK (due_at >= created_at),
  completed_at timestamptz,
  reason varchar(200),
  CHECK ((requested_outcome = 'DELAYED_SUCCESS' AND delay_seconds IS NOT NULL AND delay_seconds BETWEEN 1 AND 600)
    OR (requested_outcome <> 'DELAYED_SUCCESS' AND delay_seconds IS NULL)),
  CHECK ((status = 'PENDING' AND completed_at IS NULL AND reason IS NULL)
    OR (status = 'SUCCEEDED' AND completed_at IS NOT NULL AND reason IS NULL)
    OR (status IN ('FAILED', 'VOIDED') AND completed_at IS NOT NULL AND reason IS NOT NULL AND length(trim(reason)) > 0))
);
CREATE INDEX payments_due_idx ON payments (due_at, id) WHERE status = 'PENDING';

CREATE TABLE bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid NOT NULL UNIQUE REFERENCES payments (id),
  account_id uuid NOT NULL REFERENCES accounts (id),
  reference varchar(10) NOT NULL UNIQUE CHECK (reference ~ '^FS[A-Z0-9]{8}$'),
  status text NOT NULL DEFAULT 'CONFIRMED' CHECK (status IN ('CONFIRMED', 'CANCELLED', 'REBOOKING', 'UNASSIGNED')),
  original_flight_id uuid NOT NULL REFERENCES flights (id),
  current_flight_id uuid REFERENCES flights (id),
  seat_id uuid,
  fare_paid_paise integer NOT NULL CHECK (fare_paid_paise > 0),
  confirmed_at timestamptz NOT NULL,
  cancellation_reason varchar(300),
  FOREIGN KEY (seat_id, current_flight_id) REFERENCES flight_seats (id, flight_id),
  CHECK ((status = 'CONFIRMED' AND current_flight_id IS NOT NULL AND seat_id IS NOT NULL)
    OR (status <> 'CONFIRMED' AND current_flight_id IS NULL AND seat_id IS NULL)),
  UNIQUE (id, seat_id, current_flight_id, account_id)
);
CREATE INDEX bookings_account_idx ON bookings (account_id, confirmed_at DESC, id);

CREATE TABLE booking_assignments (
  booking_id uuid NOT NULL REFERENCES bookings (id),
  flight_id uuid NOT NULL REFERENCES flights (id),
  seat_id uuid NOT NULL,
  assigned_at timestamptz NOT NULL,
  PRIMARY KEY (booking_id, flight_id),
  FOREIGN KEY (seat_id, flight_id) REFERENCES flight_seats (id, flight_id)
);

-- Existing hold claims stay in place. Payment success converts the same row.
ALTER TABLE seat_allocations ALTER COLUMN hold_id DROP NOT NULL;
ALTER TABLE seat_allocations ADD COLUMN booking_id uuid UNIQUE;
ALTER TABLE seat_allocations ADD FOREIGN KEY (booking_id, seat_id, flight_id, account_id)
  REFERENCES bookings (id, seat_id, current_flight_id, account_id);
ALTER TABLE seat_allocations ADD CHECK (
  (hold_id IS NOT NULL AND booking_id IS NULL) OR (hold_id IS NULL AND booking_id IS NOT NULL)
);
