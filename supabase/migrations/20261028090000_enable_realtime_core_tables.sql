-- Turns on Postgres Changes (Realtime) for the tables admin-react's
-- stores keep live in the browser -- without this, Supabase never
-- broadcasts row changes at all, no matter what the client subscribes
-- to. RLS (already enabled on every one of these) still applies: a
-- client only gets told about a row it could have SELECTed anyway.
alter publication supabase_realtime add table
  public.tickets,
  public.current_projects,
  public.backlog_projects,
  public.work_orders,
  public.equipment_inventory,
  public.lps_resource_assignments,
  public.calendar_events,
  public.staff_roles,
  public.saved_filter_views;
