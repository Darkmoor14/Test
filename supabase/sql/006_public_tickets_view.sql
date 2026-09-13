-- Rewritten public_tickets view. Drops description and any name field
-- entirely (previously: description shown unmasked, and a public_name
-- field of unknown/unverifiable origin -- see the P1 finding this
-- addresses). Address is kept exact and unmasked -- it identifies
-- WHERE the reported infrastructure fault is (which pole, which
-- stretch of street), not the reporter's home, and this is a public
-- transparency page about street-lighting faults -- vague location
-- data would defeat the point of it. (An earlier version of this file
-- generalized address down to a street-only "area"; that was wrong
-- for this data and has been reverted.)
--
-- security_invoker = false (the default since Postgres 15, made
-- explicit here for audit clarity) means this view runs with the
-- view owner's privileges, not the caller's -- this is what lets
-- `anon` read through it at all despite `tickets` itself denying
-- anon direct access via RLS. Do NOT set this to true; that would
-- make the view enforce the CALLER's RLS instead, and anon has none,
-- so the public pages would silently show zero tickets.

create or replace view public.public_tickets
with (security_invoker = false) as
select
  id,
  ticket_number,
  type,
  case when status = 'Terminat' then 'Terminat' else 'Ongoing' end as status,
  address,
  submitted_on,
  resolved_on
from public.tickets
where archived = false;

comment on view public.public_tickets is
  'Public-safe view: no name/phone/email, no free-text description. Address is kept exact -- it is the fault location, not the reporter''s address. Underlying `tickets` table RLS must continue to deny anon direct access entirely -- this view is the only public-facing surface.';

grant select on public.public_tickets to anon, authenticated;
