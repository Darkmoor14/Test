-- Removes the server-side ">50% over the manufacturer-rated figure"
-- fuel-consumption alert (check_vehicle_month_fuel_consumption,
-- fired by trg_check_vehicle_fuel_consumption on vehicle_fuel_logs
-- and trg_check_vehicle_fuel_purchases on vehicle_fuel_purchases).
-- This was the server-side mirror of the client's own overLimit flag
-- in erp.js, which has since moved to a 3-month rolling-average spike
-- check instead of a fixed x1.5 against fuel_rated_consumption_km/
-- hours (a figure that, on this fleet, was often never filled in
-- accurately -- several vehicles' "normat" values turned out to be
-- way off from their real behavior while tracing unrelated leftover-
-- estimate bugs). Dropped outright rather than ported to match,
-- since the client-side report is already the one place this gets
-- surfaced to staff.
drop trigger if exists trg_check_vehicle_fuel_consumption on public.vehicle_fuel_logs;
drop trigger if exists trg_check_vehicle_fuel_purchases on public.vehicle_fuel_purchases;
drop function if exists public.trg_vehicle_fuel_logs_check();
drop function if exists public.trg_vehicle_fuel_purchases_check();
drop function if exists public.check_vehicle_month_fuel_consumption(uuid, integer, integer);
