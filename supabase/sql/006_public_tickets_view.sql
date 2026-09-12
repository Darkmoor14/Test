-- Rewritten public_tickets view. Drops description and any name field
-- entirely (previously: description shown unmasked, and a public_name
-- field of unknown/unverifiable origin -- see the P1 finding this
-- addresses). Replaces the full address with a generalized `area`.
--
-- The area extraction is a best-effort regex, not a guarantee: it
-- strips a trailing house/block number ("nr. 35", "35", "35A") and
-- anything after the first comma (apartment/block detail citizens
-- often add). It assumes Romanian free-text address conventions and
-- WILL occasionally leave a number in (an address with no number at
-- all, or an unusual format) or strip a bit too much. If exact street-
-- level precision matters, the real fix is splitting address into
-- separate street/number columns on `tickets` going forward, not a
-- regex on free text -- this is a stopgap for the current schema.
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
  regexp_replace(
    regexp_replace(coalesce(address, ''), '\s*,.*$', ''),
    '\s+(nr\.?\s*)?\d+[a-zA-Z]?\s*$', '', 'i'
  ) as area,
  submitted_on,
  resolved_on
from public.tickets
where archived = false;

comment on view public.public_tickets is
  'Public-safe view: no name/phone/email, no free-text description, address generalized to area. Underlying `tickets` table RLS must continue to deny anon direct access entirely -- this view is the only public-facing surface.';

grant select on public.public_tickets to anon, authenticated;
