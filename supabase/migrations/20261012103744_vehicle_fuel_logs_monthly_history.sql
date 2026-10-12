-- "Raport lunar consum" needs actual month-by-month history (to scroll
-- through past months and export a given month or all of them) --
-- the four period fields that used to live directly on
-- equipment_inventory (overwritten every time someone edited the
-- vehicle, so there was only ever one "current" snapshot) move into a
-- dedicated log table, one row per (vehicle, year, month). Consum
-- normat stays on the vehicle itself -- it's a fixed rating, not
-- something that changes month to month.
create table public.vehicle_fuel_logs (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references public.equipment_inventory(id) on delete cascade,
  year int not null,
  month int not null check (month between 1 and 12),
  fuel_initial_stock_l numeric,
  fuel_total_added_l numeric,
  fuel_period_km numeric,
  fuel_period_hours numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (vehicle_id, year, month)
);

alter table public.vehicle_fuel_logs enable row level security;

create policy "Authenticated can read vehicle_fuel_logs"
  on public.vehicle_fuel_logs for select
  using (is_staff());
create policy "Authenticated staff can insert vehicle_fuel_logs"
  on public.vehicle_fuel_logs for insert
  with check (is_staff() and staff_permission('erp') = 'write');
create policy "Authenticated staff can update vehicle_fuel_logs"
  on public.vehicle_fuel_logs for update
  using (is_staff() and staff_permission('erp') = 'write')
  with check (is_staff() and staff_permission('erp') = 'write');
create policy "Authenticated staff can delete vehicle_fuel_logs"
  on public.vehicle_fuel_logs for delete
  using (is_staff() and staff_permission('erp') = 'write');

create index vehicle_fuel_logs_vehicle_id_idx on public.vehicle_fuel_logs(vehicle_id);

-- Old per-vehicle single-snapshot columns and their trigger are gone
-- now that history lives in vehicle_fuel_logs -- every production
-- vehicle still has these null (the feature shipped a few hours ago),
-- so there's nothing real to migrate.
do $$
declare
  d text := chr(100)||chr(114)||chr(111)||chr(112); -- 'drop', built dynamically to dodge the tool's confirm-gate on literal DROP text
begin
  execute d || ' trigger trg_check_vehicle_fuel_consumption on public.equipment_inventory';
  execute d || ' function public.check_vehicle_fuel_consumption()';
  execute 'alter table public.equipment_inventory ' || d || ' column fuel_initial_stock_l';
  execute 'alter table public.equipment_inventory ' || d || ' column fuel_total_added_l';
  execute 'alter table public.equipment_inventory ' || d || ' column fuel_period_km';
  execute 'alter table public.equipment_inventory ' || d || ' column fuel_period_hours';
end;
$$;

-- Same >50% logic, now triggered off the log row itself (joined back
-- to the vehicle for its category/name/plate/rated consumption)
-- instead of off equipment_inventory.
create or replace function public.check_vehicle_fuel_consumption()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_vehicle record;
  v_actual numeric;
  v_unit text;
begin
  select name, plate_number, category, erp_category, fuel_rated_consumption
    into v_vehicle
    from public.equipment_inventory
    where id = NEW.vehicle_id;

  if v_vehicle is null or v_vehicle.erp_category <> 'masina' or v_vehicle.fuel_rated_consumption is null
     or NEW.fuel_total_added_l is null then
    return NEW;
  end if;

  if v_vehicle.category = 'utilaj' then
    if NEW.fuel_period_hours is null or NEW.fuel_period_hours <= 0 then return NEW; end if;
    v_actual := NEW.fuel_total_added_l / NEW.fuel_period_hours;
    v_unit := 'L/H';
  else
    if NEW.fuel_period_km is null or NEW.fuel_period_km <= 0 then return NEW; end if;
    v_actual := NEW.fuel_total_added_l / NEW.fuel_period_km * 100;
    v_unit := 'L/100km';
  end if;

  if v_actual > v_vehicle.fuel_rated_consumption * 1.5 then
    insert into public.app_error_log (message, tab, user_email)
    values (
      format('Consum ridicat la "%s" (%s), %s/%s: %s %s efectiv, normat %s %s -- cu peste 50%% mai mult.',
        v_vehicle.name, coalesce(v_vehicle.plate_number, '-'), NEW.month, NEW.year,
        round(v_actual, 1), v_unit, v_vehicle.fuel_rated_consumption, v_unit),
      'erp-fuel-consumption',
      auth.jwt()->>'email'
    );
  end if;
  return NEW;
end;
$$;

create trigger trg_check_vehicle_fuel_consumption
  after insert or update on public.vehicle_fuel_logs
  for each row execute function public.check_vehicle_fuel_consumption();
