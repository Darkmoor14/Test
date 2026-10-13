alter table public.equipment_inventory
  add column if not exists fuel_service_due_km numeric,
  add column if not exists fuel_service_due_hours numeric;
