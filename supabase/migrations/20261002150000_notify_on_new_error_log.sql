-- Alert god accounts (email + push) when a new, distinct client-side
-- error is logged -- reusing the same bright-processor/send-push
-- pipeline the ticket notify trigger already uses, same shared-secret
-- auth pattern. logAppError() already dedupes identical messages for
-- 30s per browser tab before writing; this adds a server-side,
-- cross-session dedup window so the same bug tripping on five
-- different staff members' screens within a few minutes only alerts
-- once, not five times.
create or replace function public.notify_new_error_log()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $$
declare
  v_secret text;
begin
  if exists (
    select 1 from public.app_error_log
    where message = NEW.message
      and id <> NEW.id
      and created_at > NEW.created_at - interval '15 minutes'
  ) then
    return NEW;
  end if;

  select decrypted_secret into v_secret
  from vault.decrypted_secrets
  where name = 'notify_shared_secret';

  if v_secret is null then
    raise warning 'notify_shared_secret is not configured -- skipping notification for error %', NEW.id;
    return NEW;
  end if;

  perform net.http_post(
    url := 'https://ebuigyyjifnjiuzsgpih.supabase.co/functions/v1/bright-processor',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-notify-secret', v_secret),
    body := jsonb_build_object('type', 'error', 'error_log_id', NEW.id)
  );

  perform net.http_post(
    url := 'https://ebuigyyjifnjiuzsgpih.supabase.co/functions/v1/send-push',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-notify-secret', v_secret),
    body := jsonb_build_object('type', 'error', 'error_log_id', NEW.id)
  );

  return NEW;
end;
$$;

create trigger trg_notify_new_error_log
  after insert on public.app_error_log
  for each row execute function public.notify_new_error_log();
