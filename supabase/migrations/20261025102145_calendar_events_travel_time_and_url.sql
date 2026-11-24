alter table public.calendar_events
  add column if not exists travel_time_minutes integer,
  add column if not exists url text;
