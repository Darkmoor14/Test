-- Raport lunar consum's leftover-fuel estimate is being rewritten to a
-- days-since-last-fill-up model (see erp.js's estimatedLeftoverFor) --
-- it needs the actual calendar day of each fill-up, not just the
-- year/month it was logged under. Nullable: every purchase logged
-- before this column existed has no real day on record, and the app
-- treats that null as "filled up on the last day of its month" (the
-- formula's own documented fallback for a same-day fill-up), rather
-- than guessing a specific day that was never actually recorded.
alter table public.vehicle_fuel_purchases add column if not exists purchase_date date;
