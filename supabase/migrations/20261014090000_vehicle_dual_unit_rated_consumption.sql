-- Camion/Autoutilitara now track both km and hours (they also run
-- stationary -- PTO/hydraulics -- not just drive), so a single
-- "fuel_rated_consumption" column whose unit depended entirely on
-- category (L/100km for everything but utilaj, L/h for utilaj) can no
-- longer represent one vehicle that needs both simultaneously. Split it
-- into two explicit columns; utilaj's existing values are L/h and move
-- to the new column, everyone else's stay as L/100km under the renamed
-- original.
alter table public.equipment_inventory
  add column if not exists fuel_rated_consumption_hours numeric;

update public.equipment_inventory
  set fuel_rated_consumption_hours = fuel_rated_consumption
  where category = 'utilaj' and fuel_rated_consumption is not null;

update public.equipment_inventory
  set fuel_rated_consumption = null
  where category = 'utilaj';

alter table public.equipment_inventory
  rename column fuel_rated_consumption to fuel_rated_consumption_km;
