alter table public.equipment_inventory
  rename column fuel_service_due_km to fuel_service_interval_km;
alter table public.equipment_inventory
  rename column fuel_service_due_hours to fuel_service_interval_hours;
alter table public.equipment_inventory
  add column if not exists fuel_service_last_km numeric,
  add column if not exists fuel_service_last_hours numeric;
