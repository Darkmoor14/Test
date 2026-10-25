-- Per-staff token for the one-way "subscribe my calendar in Apple
-- Calendar" feed (supabase/functions/calendar-feed). The feed is an
-- unauthenticated GET (Apple Calendar sends no session/anon-key
-- headers at all when polling a subscribed calendar), so the token
-- itself is the only gate -- same shared-secret-style posture already
-- used for report_backup_status()/notify_new_error_log(), just scoped
-- per person instead of per feature.
--
-- RLS is enabled with no policies at all: nobody can read, insert or
-- update this table directly through PostgREST. The two functions
-- below are SECURITY DEFINER and are the only way in or out, so a
-- token is always server-generated, never client-supplied.
create table public.calendar_feed_tokens (
  email text primary key,
  token text not null unique,
  created_at timestamptz not null default now()
);

alter table public.calendar_feed_tokens enable row level security;

create or replace function public.get_or_create_calendar_feed_token()
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_email text := auth.jwt()->>'email';
  v_token text;
begin
  if v_email is null or not public.is_staff() then
    raise exception 'Trebuie să fii autentificat ca personal.';
  end if;

  select token into v_token from public.calendar_feed_tokens where email = v_email;
  if v_token is not null then
    return v_token;
  end if;

  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  insert into public.calendar_feed_tokens (email, token) values (v_email, v_token);
  return v_token;
end;
$$;

grant execute on function public.get_or_create_calendar_feed_token() to authenticated;

create or replace function public.regenerate_calendar_feed_token()
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_email text := auth.jwt()->>'email';
  v_token text;
begin
  if v_email is null or not public.is_staff() then
    raise exception 'Trebuie să fii autentificat ca personal.';
  end if;

  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  insert into public.calendar_feed_tokens (email, token)
  values (v_email, v_token)
  on conflict (email) do update set token = excluded.token, created_at = now();
  return v_token;
end;
$$;

grant execute on function public.regenerate_calendar_feed_token() to authenticated;
