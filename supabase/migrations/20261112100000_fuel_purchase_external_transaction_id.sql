-- Raport lunar consum's new PDF import (Rompetrol "List Transactions"
-- exports) needs a way to tell "already imported" apart from "new" on a
-- re-upload or an overlapping date range. Rompetrol's own "Nr. tranz."
-- is a stable, globally-unique id per fill-up, so it's stored verbatim
-- and indexed unique (partial -- manually-entered rows, past and
-- future, simply never set it, and must stay free to coexist).
alter table public.vehicle_fuel_purchases add column if not exists external_transaction_id text;
create unique index if not exists vehicle_fuel_purchases_external_transaction_id_key
  on public.vehicle_fuel_purchases (external_transaction_id)
  where external_transaction_id is not null;
