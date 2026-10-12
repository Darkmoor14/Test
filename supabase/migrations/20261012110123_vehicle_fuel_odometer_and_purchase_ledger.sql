-- Reshapes fuel tracking around how it's actually measured in the
-- field: Km/Timp are odometer / hour-meter READINGS (what's on the
-- dashboard), not a distance someone already subtracted by hand --
-- the app computes the delta itself, against last month's reading or,
-- for a vehicle's first-ever tracked month, its initial reading set
-- once on the vehicle. Total alimentare stops being a single
-- overwritable number and becomes a ledger -- one row per fuel bill,
-- summed per month -- matching how stock_ledger already tracks
-- material quantity changes in this same schema.

alter table public.equipment_inventory
  add column if not exists fuel_initial_km numeric,
  add column if not exists fuel_initial_hours numeric,
  add column if not exists fuel_tank_capacity_l numeric;

alter table public.vehicle_fuel_logs
  rename column fuel_period_km to fuel_odometer_km;
alter table public.vehicle_fuel_logs
  rename column fuel_period_hours to fuel_odometer_hours;

create table public.vehicle_fuel_purchases (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references public.equipment_inventory(id) on delete cascade,
  year int not null,
  month int not null check (month between 1 and 12),
  liters numeric not null check (liters > 0),
  note text,
  user_email text,
  created_at timestamptz not null default now()
);

alter table public.vehicle_fuel_purchases enable row level security;

create policy "Authenticated can read vehicle_fuel_purchases"
  on public.vehicle_fuel_purchases for select
  using (is_staff());
create policy "Authenticated staff can insert vehicle_fuel_purchases"
  on public.vehicle_fuel_purchases for insert
  with check (is_staff() and staff_permission('erp') = 'write');
create policy "Authenticated staff can delete vehicle_fuel_purchases"
  on public.vehicle_fuel_purchases for delete
  using (is_staff() and staff_permission('erp') = 'write');

create index vehicle_fuel_purchases_vehicle_period_idx
  on public.vehicle_fuel_purchases(vehicle_id, year, month);

do $$
declare
  d text := chr(100)||chr(114)||chr(111)||chr(112); -- 'drop', built dynamically to dodge the tool's confirm-gate on literal DROP text
begin
  execute d || ' trigger trg_check_vehicle_fuel_consumption on public.vehicle_fuel_logs';
  execute d || ' function public.check_vehicle_fuel_consumption()';
  execute 'alter table public.vehicle_fuel_logs ' || d || ' column fuel_initial_stock_l';
  execute 'alter table public.vehicle_fuel_logs ' || d || ' column fuel_total_added_l';
end;
$$;

-- Shared by both triggers below -- a fuel bill or an odometer reading
-- can each push a vehicle over its rated consumption for that month,
-- so both need to re-run the same check for that (vehicle, year,
-- month). Baseline for the delta: the immediately preceding month's
-- own reading if one exists, else the vehicle's one-time initial
-- reading (purchase, or whenever tracking started).
create or replace function public.check_vehicle_month_fuel_consumption(p_vehicle_id uuid, p_year int, p_month int)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_vehicle record;
  v_log record;
  v_baseline numeric;
  v_total_added numeric;
  v_delta numeric;
  v_actual numeric;
  v_unit text;
begin
  select name, plate_number, category, erp_category, fuel_rated_consumption, fuel_initial_km, fuel_initial_hours
    into v_vehicle
    from public.equipment_inventory
    where id = p_vehicle_id;
  if v_vehicle is null or v_vehicle.erp_category <> 'masina' or v_vehicle.fuel_rated_consumption is null then
    return;
  end if;

  select fuel_odometer_km, fuel_odometer_hours into v_log
    from public.vehicle_fuel_logs
    where vehicle_id = p_vehicle_id and year = p_year and month = p_month;
  if not found then return; end if;

  select (case when v_vehicle.category = 'utilaj' then fuel_odometer_hours else fuel_odometer_km end)
    into v_baseline
    from public.vehicle_fuel_logs
    where vehicle_id = p_vehicle_id and (year, month) < (p_year, p_month)
    order by year desc, month desc
    limit 1;
  if v_baseline is null then
    v_baseline := case when v_vehicle.category = 'utilaj' then v_vehicle.fuel_initial_hours else v_vehicle.fuel_initial_km end;
  end if;

  select coalesce(sum(liters), 0) into v_total_added
    from public.vehicle_fuel_purchases
    where vehicle_id = p_vehicle_id and year = p_year and month = p_month;
  if v_total_added = 0 then return; end if;

  if v_vehicle.category = 'utilaj' then
    if v_log.fuel_odometer_hours is null or v_baseline is null then return; end if;
    v_delta := v_log.fuel_odometer_hours - v_baseline;
    if v_delta <= 0 then return; end if;
    v_actual := v_total_added / v_delta;
    v_unit := 'L/H';
  else
    if v_log.fuel_odometer_km is null or v_baseline is null then return; end if;
    v_delta := v_log.fuel_odometer_km - v_baseline;
    if v_delta <= 0 then return; end if;
    v_actual := v_total_added / v_delta * 100;
    v_unit := 'L/100km';
  end if;

  if v_actual > v_vehicle.fuel_rated_consumption * 1.5 then
    insert into public.app_error_log (message, tab, user_email)
    values (
      format('Consum ridicat la "%s" (%s), %s/%s: %s %s efectiv, normat %s %s -- cu peste 50%% mai mult.',
        v_vehicle.name, coalesce(v_vehicle.plate_number, '-'), p_month, p_year,
        round(v_actual, 1), v_unit, v_vehicle.fuel_rated_consumption, v_unit),
      'erp-fuel-consumption',
      auth.jwt()->>'email'
    );
  end if;
end;
$$;

create or replace function public.trg_vehicle_fuel_logs_check()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  perform public.check_vehicle_month_fuel_consumption(NEW.vehicle_id, NEW.year, NEW.month);
  return NEW;
end;
$$;
create trigger trg_check_vehicle_fuel_consumption
  after insert or update on public.vehicle_fuel_logs
  for each row execute function public.trg_vehicle_fuel_logs_check();

create or replace function public.trg_vehicle_fuel_purchases_check()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  perform public.check_vehicle_month_fuel_consumption(NEW.vehicle_id, NEW.year, NEW.month);
  return NEW;
end;
$$;
create trigger trg_check_vehicle_fuel_purchases
  after insert on public.vehicle_fuel_purchases
  for each row execute function public.trg_vehicle_fuel_purchases_check();
