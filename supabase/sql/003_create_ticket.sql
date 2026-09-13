-- create_ticket() -- reconciled against the real deployed source
-- (provided directly, no longer a guess). What's UNCHANGED from the
-- real function, left exactly as-is:
--   - ticket_number is NOT generated in here. It comes from an
--     existing BEFORE INSERT trigger (trg_set_ticket_number /
--     set_ticket_number(), both already live -- not touched or
--     re-created by this file) that reads from ticket_number_seq.
--     This function still just does a plain insert + `returning
--     ticket_number`, same as the real one.
--   - status and submitted_on are left to their column defaults
--     ('Ongoing' and now()), not set explicitly, matching the real
--     function's style.
--   - The six original parameters, in the same order, same types.
--
-- What's ADDED, and nothing else:
--   - One new optional parameter, p_captcha_token (defaults to null,
--     so admin.html's existing 6-argument calls are unaffected).
--   - A CAPTCHA + rate-limit check that runs ONLY when the caller is
--     anonymous (auth.role() = 'anon') -- staff calling this from
--     admin.html are unaffected: no CAPTCHA, no rate limit, nothing
--     new to configure on that side.
--   - A new created_via_public column (ALTER TABLE below), set based
--     on whether the caller was anonymous. The notify trigger
--     (005_notify_triggers.sql) reads this to fire only for citizen
--     submissions -- staff-created tickets keep using admin.html's
--     own existing, already-authenticated notify calls, so nothing
--     gets double-notified.

alter table public.tickets
  add column if not exists created_via_public boolean not null default false;

comment on column public.tickets.created_via_public is
  'Set by create_ticket() based on whether the caller was anonymous. Read by the notify trigger (005) to fire only for citizen submissions, not staff-entered tickets (admin.html sends its own notifications already).';

-- IMPORTANT: adding a parameter does NOT replace the original
-- 6-argument function -- Postgres treats a different argument count
-- as a distinct function identity, so CREATE OR REPLACE alone would
-- leave the old, unprotected 6-argument version callable side by
-- side with the new one, completely bypassing the CAPTCHA/rate-limit
-- check below. It has to be dropped explicitly first.
drop function if exists public.create_ticket(text, text, text, text, text, text);

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

  insert into tickets (type, name, phone, email, address, description, created_via_public)
  values (p_type, p_name, p_phone, p_email, p_address, p_description, v_is_anon)
  returning ticket_number into v_ticket_number;

  return v_ticket_number;
end;
$$;

-- The DROP above removed the old function's grants along with it, so
-- this has to be re-stated explicitly. Matches the real function's
-- own grant exactly (anon only) -- staff access keeps working the
-- same way it did before: a newly created function is executable by
-- PUBLIC (which includes `authenticated`) by default unless revoked,
-- same implicit privilege the original function relied on.
grant execute on function public.create_ticket(text, text, text, text, text, text, text) to anon;
