-- Needed for CalDAV (supabase/functions/calendar-dav): ETags and
-- sync-collection tokens both need a reliable "last changed" marker per
-- row, which calendar_events didn't have before (only created_at, which
-- never moves after an edit).
alter table public.calendar_events add column updated_at timestamptz not null default now();
update public.calendar_events set updated_at = created_at;

create or replace function public.set_calendar_events_updated_at()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger calendar_events_set_updated_at
before update on public.calendar_events
for each row execute function public.set_calendar_events_updated_at();

-- A deleted event has to actually stop existing in calendar_events (the
-- app's own delete flow still works exactly as before), but CalDAV's
-- sync-collection REPORT needs a way to tell a client "this one's gone"
-- since its last sync -- otherwise a phone that already pulled an event
-- would never learn it was removed and would keep it forever. This is
-- that record: one row per deleted event, kept independently of the
-- row it refers to.
create table public.calendar_events_tombstones (
  id uuid primary key,
  deleted_at timestamptz not null default now()
);
alter table public.calendar_events_tombstones enable row level security;

create or replace function public.log_calendar_event_tombstone()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  insert into public.calendar_events_tombstones (id, deleted_at) values (old.id, now())
  on conflict (id) do update set deleted_at = now();
  return old;
end;
$$;

create trigger calendar_events_log_tombstone
after delete on public.calendar_events
for each row execute function public.log_calendar_event_tombstone();
