-- check_vehicle_month_fuel_consumption (the server-side mirror of the
-- client's overLimit alert, fired by trg_vehicle_fuel_logs_check on
-- every vehicle_fuel_logs insert/update) still referenced the single
-- fuel_rated_consumption column the previous migration renamed/split.
-- Rewritten to check the km side and hours side independently, each
-- against its own rated figure/baseline/delta -- matching the dual
-- tracking Camion/Autoutilitara now get on the client.
create or replace function public.check_vehicle_month_fuel_consumption(p_vehicle_id uuid, p_year integer, p_month integer)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_vehicle record;
  v_log record;
  v_total_added numeric;
  v_baseline numeric;
  v_delta numeric;
  v_actual numeric;
begin
  select name, plate_number, category, erp_category,
         fuel_rated_consumption_km, fuel_rated_consumption_hours,
         fuel_initial_km, fuel_initial_hours
    into v_vehicle
    from public.equipment_inventory
    where id = p_vehicle_id;
  if v_vehicle is null or v_vehicle.erp_category <> 'masina' then
    return;
  end if;

  select fuel_odometer_km, fuel_odometer_hours into v_log
    from public.vehicle_fuel_logs
    where vehicle_id = p_vehicle_id and year = p_year and month = p_month;
  if not found then return; end if;

  select coalesce(sum(liters), 0) into v_total_added
    from public.vehicle_fuel_purchases
    where vehicle_id = p_vehicle_id and year = p_year and month = p_month;
  if v_total_added = 0 then return; end if;

  -- Km side: masina_mica/autoutilitara/camion.
  if v_vehicle.category <> 'utilaj' and v_vehicle.fuel_rated_consumption_km is not null and v_log.fuel_odometer_km is not null then
    select fuel_odometer_km into v_baseline
      from public.vehicle_fuel_logs
      where vehicle_id = p_vehicle_id and fuel_odometer_km is not null and (year, month) < (p_year, p_month)
      order by year desc, month desc
      limit 1;
    if v_baseline is null then v_baseline := v_vehicle.fuel_initial_km; end if;
    if v_baseline is not null then
      v_delta := v_log.fuel_odometer_km - v_baseline;
      if v_delta > 0 then
        v_actual := v_total_added / v_delta * 100;
        if v_actual > v_vehicle.fuel_rated_consumption_km * 1.5 then
          insert into public.app_error_log (message, tab, user_email)
          values (
            format('Consum ridicat la "%s" (%s), %s/%s: %s L/100km efectiv, normat %s L/100km -- cu peste 50%% mai mult.',
              v_vehicle.name, coalesce(v_vehicle.plate_number, '-'), p_month, p_year,
              round(v_actual, 1), v_vehicle.fuel_rated_consumption_km),
            'erp-fuel-consumption',
            auth.jwt()->>'email'
          );
        end if;
      end if;
    end if;
  end if;

  -- Hours side: utilaj/camion/autoutilitara (also run stationary).
  if (v_vehicle.category = 'utilaj' or v_vehicle.category = 'camion' or v_vehicle.category = 'autoutilitara')
     and v_vehicle.fuel_rated_consumption_hours is not null and v_log.fuel_odometer_hours is not null then
    select fuel_odometer_hours into v_baseline
      from public.vehicle_fuel_logs
      where vehicle_id = p_vehicle_id and fuel_odometer_hours is not null and (year, month) < (p_year, p_month)
      order by year desc, month desc
      limit 1;
    if v_baseline is null then v_baseline := v_vehicle.fuel_initial_hours; end if;
    if v_baseline is not null then
      v_delta := v_log.fuel_odometer_hours - v_baseline;
      if v_delta > 0 then
        v_actual := v_total_added / v_delta;
        if v_actual > v_vehicle.fuel_rated_consumption_hours * 1.5 then
          insert into public.app_error_log (message, tab, user_email)
          values (
            format('Consum ridicat la "%s" (%s), %s/%s: %s L/H efectiv, normat %s L/H -- cu peste 50%% mai mult.',
              v_vehicle.name, coalesce(v_vehicle.plate_number, '-'), p_month, p_year,
              round(v_actual, 1), v_vehicle.fuel_rated_consumption_hours),
            'erp-fuel-consumption',
            auth.jwt()->>'email'
          );
        end if;
      end if;
    end if;
  end if;
end;
$function$;
