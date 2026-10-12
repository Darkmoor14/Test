-- Parc Auto: monthly fuel-consumption tracking. Five new vehicle-only
-- fields (blank/irrelevant for echipament/material/produs rows, same
-- soft convention as the existing document-expiry columns on this
-- shared table): a starting fuel stock, total fuel added, and the
-- km (or, for utilaje, hours) covered in the period being tracked,
-- plus a rated/target consumption entered once per vehicle. Actual
-- consumption is computed from these (L/100km for everything except
-- 'utilaj', which uses L/H instead) -- client-side for display, and
-- here again, server-side, so the over-consumption alert below can't
-- be bypassed by going straight through the API.
alter table public.equipment_inventory
  add column if not exists fuel_initial_stock_l numeric,
  add column if not exists fuel_total_added_l numeric,
  add column if not exists fuel_period_km numeric,
  add column if not exists fuel_period_hours numeric,
  add column if not exists fuel_rated_consumption numeric;

-- Reuses the existing app_error_log -> trg_notify_new_error_log ->
-- bright-processor/send-push pipeline (email + push to god accounts,
-- with its own 15-minute identical-message dedup) rather than building
-- a second alert channel -- "send us an error" is exactly what that
-- pipeline already does for client-side bugs.
create or replace function public.check_vehicle_fuel_consumption()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_actual numeric;
  v_unit text;
begin
  if NEW.erp_category <> 'masina' or NEW.fuel_rated_consumption is null or NEW.fuel_total_added_l is null then
    return NEW;
  end if;
  if NEW.category = 'utilaj' then
    if NEW.fuel_period_hours is null or NEW.fuel_period_hours <= 0 then return NEW; end if;
    v_actual := NEW.fuel_total_added_l / NEW.fuel_period_hours;
    v_unit := 'L/H';
  else
    if NEW.fuel_period_km is null or NEW.fuel_period_km <= 0 then return NEW; end if;
    v_actual := NEW.fuel_total_added_l / NEW.fuel_period_km * 100;
    v_unit := 'L/100km';
  end if;
  if v_actual > NEW.fuel_rated_consumption * 1.5 then
    insert into public.app_error_log (message, tab, user_email)
    values (
      format('Consum ridicat la "%s" (%s): %s %s efectiv, normat %s %s -- cu peste 50%% mai mult.',
        NEW.name, coalesce(NEW.plate_number, '-'), round(v_actual, 1), v_unit, NEW.fuel_rated_consumption, v_unit),
      'erp-fuel-consumption',
      auth.jwt()->>'email'
    );
  end if;
  return NEW;
end;
$$;

create trigger trg_check_vehicle_fuel_consumption
  after insert or update on public.equipment_inventory
  for each row execute function public.check_vehicle_fuel_consumption();
