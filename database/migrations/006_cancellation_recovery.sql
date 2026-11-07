CREATE TABLE cancellation_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  flight_id uuid NOT NULL UNIQUE REFERENCES flights (id),
  admin_id uuid NOT NULL REFERENCES accounts (id),
  reason varchar(300) NOT NULL CHECK (length(trim(reason)) > 0),
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED')),
  created_at timestamptz NOT NULL,
  completed_at timestamptz,
  error varchar(500),
  last_attempt_at timestamptz,
  CHECK ((status = 'COMPLETED' AND completed_at IS NOT NULL AND error IS NULL)
    OR (status IN ('PENDING', 'RUNNING') AND completed_at IS NULL AND error IS NULL)
    OR (status = 'FAILED' AND completed_at IS NULL AND error IS NOT NULL AND length(trim(error)) > 0))
);
CREATE INDEX cancellation_pending_idx ON cancellation_tasks (last_attempt_at, created_at, id)
  WHERE status <> 'COMPLETED';

CREATE TABLE recovery_items (
  task_id uuid NOT NULL REFERENCES cancellation_tasks (id),
  booking_id uuid NOT NULL REFERENCES bookings (id),
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'REBOOKED', 'UNASSIGNED')),
  PRIMARY KEY (task_id, booking_id)
);
CREATE UNIQUE INDEX recovery_pending_booking_idx ON recovery_items (booking_id) WHERE status = 'PENDING';
