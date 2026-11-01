-- Older payments keep null details; checkout now collects one passenger's name and age.
ALTER TABLE payments ADD COLUMN passenger_name varchar(100);
ALTER TABLE payments ADD COLUMN passenger_age integer;
ALTER TABLE payments ADD CHECK (
  (passenger_name IS NULL AND passenger_age IS NULL)
  OR (passenger_name IS NOT NULL AND length(trim(passenger_name)) > 0
    AND passenger_age IS NOT NULL AND passenger_age BETWEEN 1 AND 120)
);
