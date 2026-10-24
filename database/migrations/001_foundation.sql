CREATE TABLE accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email varchar(254) NOT NULL UNIQUE,
  password_hash text NOT NULL,
  role text NOT NULL DEFAULT 'PASSENGER' CHECK (role IN ('PASSENGER', 'ADMIN')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (email <> '' AND email = lower(trim(email)))
);

CREATE TABLE sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  CHECK (expires_at > created_at)
);

CREATE INDEX sessions_account_idx ON sessions (account_id);

CREATE TABLE airports (
  code text PRIMARY KEY,
  name text NOT NULL,
  CHECK (
    (code, name) IN (
      ('DEL', 'Delhi'),
      ('BHO', 'Bhopal'),
      ('BLR', 'Bangalore')
    )
  )
);

CREATE TABLE aircraft_layouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  row_count integer NOT NULL CHECK (row_count BETWEEN 1 AND 99),
  columns text[] NOT NULL CHECK (cardinality(columns) > 0),
  aisle_after text[] NOT NULL,
  CHECK (aisle_after <@ columns)
);

CREATE TABLE flights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  flight_number varchar(12) NOT NULL,
  origin text NOT NULL REFERENCES airports (code),
  destination text NOT NULL REFERENCES airports (code),
  departure_at timestamptz NOT NULL,
  arrival_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'SCHEDULED',
  fare_paise integer NOT NULL CHECK (fare_paise > 0),
  layout_id uuid NOT NULL REFERENCES aircraft_layouts (id),
  CHECK (origin <> destination),
  CHECK (arrival_at > departure_at),
  CHECK (status IN ('SCHEDULED', 'CANCELLED', 'DEPARTED')),
  UNIQUE (flight_number, departure_at)
);

CREATE INDEX flights_search_idx ON flights (origin, destination, departure_at);

-- Each dated flight has its own seats. Holds and bookings will reference these IDs.
CREATE TABLE flight_seats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  flight_id uuid NOT NULL REFERENCES flights (id),
  label text NOT NULL,
  row_number integer NOT NULL CHECK (row_number BETWEEN 1 AND 99),
  column_letter text NOT NULL CHECK (column_letter ~ '^[A-Z]$'),
  CHECK (label = row_number::text || column_letter),
  UNIQUE (flight_id, label)
);
