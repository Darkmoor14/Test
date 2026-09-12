-- REFERENCE REWRITE of create_ticket() -- see supabase/sql/README.md.
-- This repo has never had the real deployed source, so treat this as
-- "here's what it should do," not a diff. What's added relative to
-- whatever's live: a new optional p_captcha_token argument, and a
-- CAPTCHA + rate-limit check that only runs for anonymous callers.
-- Staff calling this from admin.html (an authenticated session) are
-- completely unaffected -- same required arguments as before, no
-- CAPTCHA, no rate limit.
--
-- Also adds a `created_via_public` column on tickets, set here, which
-- the notify trigger (004) uses to fire ONLY for citizen-submitted
-- tickets -- staff-created tickets keep using admin.html's own
-- existing (already-authenticated) notify calls, untouched, so
-- nothing gets double-notified.

alter table public.tickets
  add column if not exists created_via_public boolean not null default false;

comment on column public.tickets.created_via_public is
  'Set by create_ticket() based on whether the caller was anonymous. Read by the notify trigger (004) to fire only for citizen submissions, not staff-entered tickets (admin.html sends its own notifications already).';

-- Only created if it doesn't already exist under this exact name --
-- if the real deployed function generates ticket numbers differently,
-- DROP this sequence/line and keep whatever's already there; the
-- format itself ("TICKET-0001") isn't a security property, just match
-- what's already live.
create sequence if not exists public.ticket_number_seq;

create or replace function public.create_ticket(
  p_type text,
  p_name text,
  p_phone text,
  p_email text,
  p_address text,
  p_description text,
  p_captcha_token text default null
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_anon boolean := auth.role() = 'anon';
  v_ticket_number text;
begin
  if v_is_anon then
    -- Rate limit first (cheap, no outbound call) -- this is also what
    -- stops someone from burning through outbound requests to
    -- Cloudflare (and your Turnstile secret's own quota) by spamming
    -- this function. CAPTCHA verification only runs at all once the
    -- caller is within the rate limit.
    perform public.check_and_log_rate_limit();

    if not public.verify_captcha(p_captcha_token) then
      raise exception 'CAPTCHA verification failed. Please try again.'
        using errcode = 'P0001';
    end if;
  end if;

  v_ticket_number := 'TICKET-' || lpad(nextval('public.ticket_number_seq')::text, 4, '0');

  insert into public.tickets (
    ticket_number, type, name, phone, email, address, description,
    status, submitted_on, archived, created_via_public
  ) values (
    v_ticket_number, p_type, p_name, p_phone, p_email, p_address, p_description,
    'Ongoing', now(), false, v_is_anon
  );

  return v_ticket_number;
end;
$$;

grant execute on function public.create_ticket(text, text, text, text, text, text, text) to anon, authenticated;
