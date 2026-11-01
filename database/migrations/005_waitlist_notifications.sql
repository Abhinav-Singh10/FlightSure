ALTER TABLE holds ADD UNIQUE (id, flight_id, account_id);

CREATE TABLE waitlist_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts (id),
  flight_id uuid NOT NULL REFERENCES flights (id),
  status text NOT NULL DEFAULT 'WAITING'
    CHECK (status IN ('WAITING', 'OFFERED', 'FULFILLED', 'WITHDRAWN', 'EXPIRED', 'CLOSED')),
  joined_at timestamptz NOT NULL,
  offer_hold_id uuid UNIQUE,
  accepted_at timestamptz,
  booking_id uuid UNIQUE REFERENCES bookings (id),
  FOREIGN KEY (offer_hold_id, flight_id, account_id) REFERENCES holds (id, flight_id, account_id),
  CHECK (status NOT IN ('OFFERED', 'FULFILLED') OR offer_hold_id IS NOT NULL),
  CHECK (status <> 'WAITING' OR (offer_hold_id IS NULL AND accepted_at IS NULL)),
  CHECK (accepted_at IS NULL OR offer_hold_id IS NOT NULL),
  CHECK ((status = 'FULFILLED' AND booking_id IS NOT NULL)
    OR (status <> 'FULFILLED' AND booking_id IS NULL))
);
CREATE UNIQUE INDEX waitlist_active_account_flight_idx ON waitlist_entries (account_id, flight_id)
  WHERE status IN ('WAITING', 'OFFERED');
CREATE INDEX waitlist_queue_idx ON waitlist_entries (flight_id, joined_at, id) WHERE status = 'WAITING';
CREATE INDEX waitlist_account_idx ON waitlist_entries (account_id, joined_at DESC, id);

CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts (id),
  event_key text NOT NULL,
  type text NOT NULL CHECK (type IN ('WAITLIST_OFFER', 'FLIGHT_CANCELLED', 'REBOOKED', 'NO_ALTERNATIVE')),
  message varchar(1000) NOT NULL CHECK (length(trim(message)) > 0),
  flight_id uuid NOT NULL REFERENCES flights (id),
  booking_id uuid REFERENCES bookings (id),
  waitlist_entry_id uuid REFERENCES waitlist_entries (id),
  created_at timestamptz NOT NULL,
  UNIQUE (account_id, event_key)
);
CREATE INDEX notifications_account_idx ON notifications (account_id, created_at DESC, id);
