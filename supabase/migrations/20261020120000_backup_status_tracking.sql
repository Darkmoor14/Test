-- Tracks the daily local pg_dump backup (run by a scheduled PowerShell
-- script on Bogdan's machine, outside this platform entirely) so "Stare
-- sistem" can show whether it's actually working, and so a failed or
-- empty dump alerts the same way every other failure here does (email +
-- push to god accounts) -- instead of silently sitting as a 0-byte file
-- that nobody notices for days, which is exactly what happened before
-- this existed.
--
-- The script can't authenticate as a logged-in staff member (it's a
-- standalone process on a local machine, not a browser session), so it
-- can't satisfy the is_staff() check the rest of this platform's writes
-- rely on. Same shape as create_ticket/submit_contact_message: a narrow,
-- single-purpose SECURITY DEFINER RPC the anon key can call, guarded by
-- its own secret (not notify_shared_secret -- that one also lets a
-- caller make bright-processor/send-push relay arbitrary ticket/error
-- content, so the backup script is only ever trusted with this table).

create table public.backup_runs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  success boolean not null,
  file_size_bytes bigint,
  dump_filename text,
  error_message text,
  host text
);

alter table public.backup_runs enable row level security;

create policy "staff can read backup runs"
  on public.backup_runs for select
  to authenticated
  using (is_staff());

-- No insert/update/delete policy for anyone -- every write goes through
-- report_backup_status() below, which runs as the table owner.

create or replace function public.report_backup_status(
  p_secret text,
  p_success boolean,
  p_file_size_bytes bigint default null,
  p_dump_filename text default null,
  p_error_message text default null,
  p_host text default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $$
declare
  v_secret text;
  v_id uuid;
begin
  select decrypted_secret into v_secret
  from vault.decrypted_secrets
  where name = 'backup_report_secret';

  if v_secret is null or p_secret is null or p_secret <> v_secret then
    raise exception 'invalid backup report secret';
  end if;

  insert into public.backup_runs (success, file_size_bytes, dump_filename, error_message, host)
  values (p_success, p_file_size_bytes, p_dump_filename, p_error_message, p_host)
  returning id into v_id;

  return v_id;
end;
$$;

grant execute on function public.report_backup_status(text, boolean, bigint, text, text, text) to anon, authenticated;

-- Same alert pipeline as notify_new_error_log() -- bright-processor for
-- email, send-push for a god-only push notification -- fired only on a
-- failed run (empty/missing dump, pg_dump error, etc). Deduped for 6h so
-- the single daily run can't fan out into repeat alerts from retries
-- (e.g. someone re-running the script by hand while chasing the same
-- underlying issue), while still alerting again on the next real
-- scheduled failure.
create or replace function public.notify_backup_failure()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $$
declare
  v_secret text;
begin
  if NEW.success then
    return NEW;
  end if;

  if exists (
    select 1 from public.backup_runs
    where success = false
      and id <> NEW.id
      and created_at > NEW.created_at - interval '6 hours'
  ) then
    return NEW;
  end if;

  select decrypted_secret into v_secret
  from vault.decrypted_secrets
  where name = 'notify_shared_secret';

  if v_secret is null then
    raise warning 'notify_shared_secret is not configured -- skipping notification for backup run %', NEW.id;
    return NEW;
  end if;

  perform net.http_post(
    url := 'https://ebuigyyjifnjiuzsgpih.supabase.co/functions/v1/bright-processor',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-notify-secret', v_secret),
    body := jsonb_build_object('type', 'backup', 'backup_run_id', NEW.id)
  );

  perform net.http_post(
    url := 'https://ebuigyyjifnjiuzsgpih.supabase.co/functions/v1/send-push',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-notify-secret', v_secret),
    body := jsonb_build_object('type', 'backup', 'backup_run_id', NEW.id)
  );

  return NEW;
end;
$$;

create trigger trg_notify_backup_failure
  after insert on public.backup_runs
  for each row execute function public.notify_backup_failure();
