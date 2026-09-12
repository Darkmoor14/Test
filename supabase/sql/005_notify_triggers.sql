-- Server-side notification triggers. These replace the PUBLIC forms'
-- direct client-side calls to the bright-processor/send-push Edge
-- Functions (raportare.html, index.html) -- the browser no longer
-- calls them at all for a citizen's own submission. admin.html's own
-- direct calls for STAFF-created tickets are untouched; see
-- created_via_public in 003_create_ticket.sql for how the two stay
-- separate.
--
-- Requires NOTIFY_SHARED_SECRET set identically in Vault (see
-- supabase/sql/README.md) and as an Edge Function secret on both
-- bright-processor and send-push.

create or replace function public.notify_new_public_ticket()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_secret text;
begin
  if not NEW.created_via_public then
    return NEW;
  end if;

  select decrypted_secret into v_secret
  from vault.decrypted_secrets
  where name = 'notify_shared_secret';

  if v_secret is null then
    raise warning 'notify_shared_secret is not configured -- skipping notification for %', NEW.ticket_number;
    return NEW;
  end if;

  -- Fire-and-forget (pg_net queues these async, off the INSERT's own
  -- transaction) -- a slow or failing notification should never hold
  -- up or roll back the ticket save itself, same principle the old
  -- client-side "never blocks the form" comments already established.
  perform net.http_post(
    url := 'https://ebuigyyjifnjiuzsgpih.supabase.co/functions/v1/bright-processor',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-notify-secret', v_secret),
    body := jsonb_build_object('type', 'ticket', 'ticket_id', NEW.id)
  );

  perform net.http_post(
    url := 'https://ebuigyyjifnjiuzsgpih.supabase.co/functions/v1/send-push',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-notify-secret', v_secret),
    body := jsonb_build_object('ticket_id', NEW.id)
  );

  return NEW;
end;
$$;

drop trigger if exists trg_notify_new_public_ticket on public.tickets;
create trigger trg_notify_new_public_ticket
  after insert on public.tickets
  for each row
  execute function public.notify_new_public_ticket();

create or replace function public.notify_new_contact_message()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_secret text;
begin
  select decrypted_secret into v_secret
  from vault.decrypted_secrets
  where name = 'notify_shared_secret';

  if v_secret is null then
    raise warning 'notify_shared_secret is not configured -- skipping notification for contact message %', NEW.id;
    return NEW;
  end if;

  perform net.http_post(
    url := 'https://ebuigyyjifnjiuzsgpih.supabase.co/functions/v1/bright-processor',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-notify-secret', v_secret),
    body := jsonb_build_object('type', 'contact', 'contact_message_id', NEW.id)
  );

  return NEW;
end;
$$;

drop trigger if exists trg_notify_new_contact_message on public.contact_messages;
create trigger trg_notify_new_contact_message
  after insert on public.contact_messages
  for each row
  execute function public.notify_new_contact_message();
