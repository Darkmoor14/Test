-- Rate limiting + CAPTCHA verification shared by create_ticket() (003)
-- and submit_contact_message() (005). Both call these two helpers --
-- and ONLY when the caller is anonymous, never for authenticated staff
-- calls from admin.html.

create table if not exists public.public_submission_log (
  id bigint generated always as identity primary key,
  ip inet not null,
  created_at timestamptz not null default now()
);

comment on table public.public_submission_log is
  'One row per anonymous public-form submission attempt (ticket or contact), used only to rate-limit. Never written to directly -- only via check_and_log_rate_limit(), called from inside create_ticket()/submit_contact_message().';

alter table public.public_submission_log enable row level security;

-- Staff can review it (e.g. to see if something is actively being
-- abused); nobody -- including staff -- gets an INSERT/UPDATE/DELETE
-- policy, since the only writes should ever come from the SECURITY
-- DEFINER function below.
create policy "staff can read submission log"
  on public.public_submission_log for select
  to authenticated
  using (true);

-- PostgREST (what Supabase RPC calls go through) sets this GUC per
-- request from the actual HTTP request headers, including whatever
-- the edge proxy determined the caller's IP to be -- this is why it's
-- available inside a plain SQL function without the client passing
-- its own IP (which it could lie about).
create or replace function public.current_request_ip()
returns inet
language sql
stable
as $$
  select coalesce(
    nullif(split_part(current_setting('request.headers', true)::json ->> 'x-forwarded-for', ',', 1), ''),
    '0.0.0.0'
  )::inet;
$$;

-- Raises an exception (aborting the calling function's transaction --
-- nothing gets inserted) if this IP has made too many attempts
-- recently. Otherwise logs this attempt and returns normally. Logs
-- BEFORE the caller does its real work, and logs every attempt
-- (successful or not) -- an attacker retrying a failed CAPTCHA
-- shouldn't get unlimited free retries.
create or replace function public.check_and_log_rate_limit(
  p_window interval default interval '10 minutes',
  p_max_attempts int default 3
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ip inet := public.current_request_ip();
  v_count int;
begin
  select count(*) into v_count
  from public.public_submission_log
  where ip = v_ip and created_at > now() - p_window;

  if v_count >= p_max_attempts then
    raise exception 'Too many submissions from this connection. Please wait a few minutes and try again.'
      using errcode = 'P0001';
  end if;

  insert into public.public_submission_log (ip) values (v_ip);
end;
$$;

-- Verifies a Cloudflare Turnstile token server-side. Requires the
-- Turnstile SECRET key in Vault under the name 'turnstile_secret_key'
-- (see supabase/sql/README.md) -- fails closed (returns false) if
-- that secret isn't configured, rather than silently skipping
-- verification.
create or replace function public.verify_captcha(p_token text)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_secret text;
  v_response extensions.http_response;
  v_body jsonb;
begin
  if p_token is null or length(trim(p_token)) = 0 then
    return false;
  end if;

  select decrypted_secret into v_secret
  from vault.decrypted_secrets
  where name = 'turnstile_secret_key';

  if v_secret is null then
    raise warning 'turnstile_secret_key is not configured in Vault -- treating this submission as unverified.';
    return false;
  end if;

  select * into v_response from extensions.http((
    'POST',
    'https://challenges.cloudflare.com/turnstile/v0/siteverify',
    array[extensions.http_header('Content-Type', 'application/x-www-form-urlencoded')],
    'application/x-www-form-urlencoded',
    'secret=' || v_secret
      || '&response=' || p_token
      || '&remoteip=' || host(public.current_request_ip())
  )::extensions.http_request);

  v_body := v_response.content::jsonb;
  return coalesce((v_body ->> 'success')::boolean, false);
exception when others then
  -- Any parsing/network failure counts as "not verified", not
  -- "skip the check" -- fail closed.
  raise warning 'verify_captcha() failed: %', sqlerrm;
  return false;
end;
$$;
