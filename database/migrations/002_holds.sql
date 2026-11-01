-- Composite keys keep every hold and allocation attached to the correct flight.
ALTER TABLE flight_seats ADD UNIQUE (id, flight_id);

CREATE TABLE holds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts (id),
  flight_id uuid NOT NULL REFERENCES flights (id),
  seat_id uuid NOT NULL,
  source text NOT NULL DEFAULT 'DIRECT' CHECK (source IN ('DIRECT', 'WAITLIST')),
  status text NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE', 'PAYMENT_PENDING', 'CONSUMED', 'RELEASED', 'EXPIRED', 'FAILED')),
  quote_paise integer NOT NULL CHECK (quote_paise > 0),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL CHECK (expires_at > created_at),
  FOREIGN KEY (seat_id, flight_id) REFERENCES flight_seats (id, flight_id),
  UNIQUE (id, seat_id, flight_id, account_id)
);

CREATE INDEX holds_expiry_idx ON holds (expires_at)
  WHERE status IN ('ACTIVE', 'PAYMENT_PENDING');
CREATE INDEX holds_account_idx ON holds (account_id);

-- Only current claims live here. Released/expired hold history stays in holds.
-- Booking ownership will be added by the payment/booking migration.
CREATE TABLE seat_allocations (
  seat_id uuid PRIMARY KEY,
  flight_id uuid NOT NULL,
  account_id uuid NOT NULL,
  hold_id uuid NOT NULL UNIQUE,
  UNIQUE (account_id, flight_id),
  FOREIGN KEY (hold_id, seat_id, flight_id, account_id)
    REFERENCES holds (id, seat_id, flight_id, account_id)
);

CREATE TABLE operations (
  account_id uuid NOT NULL REFERENCES accounts (id),
  operation text NOT NULL,
  idempotency_key uuid NOT NULL,
  payload jsonb NOT NULL,
  http_status integer,
  data jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, operation, idempotency_key),
  CHECK ((http_status IS NULL AND data IS NULL) OR (http_status BETWEEN 200 AND 299 AND data IS NOT NULL))
);
