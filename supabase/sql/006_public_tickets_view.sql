-- Rewritten public_tickets view. Drops description and phone/email
-- entirely -- see the P1 finding this addresses. Address is kept
-- exact and unmasked -- it identifies WHERE the reported infrastructure
-- fault is (which pole, which stretch of street), not the reporter's
-- home, and this is a public transparency page about street-lighting
-- faults -- vague location data would defeat the point of it.
--
-- `name` is a GDPR problem in general (a real citizen's own name has
-- no business being public) but is also overloaded in this schema: an
-- admin.html-logged ticket that didn't come from an individual citizen
-- stores its source in the same `name` column -- "Autosesizare" (the
-- company's own detection), "Poliția locală", "Birou energetic". Those
-- three are organizational sources, not personal data, and ARE meant
-- to show publicly -- everything else in `name` is presumed to be an
-- actual person's name and stays hidden, same as it already behaves
-- live. `public_name` below is null unless `name` matches this
-- allowlist (case/diacritic-insensitive, to survive "Politia locala"
-- vs "Poliția locală" typed differently by different staff).
--
-- IMPORTANT: if the real stored values differ from the three below --
-- a different spelling, an extra institutional source not listed here
-- -- this allowlist needs updating to match, or a legitimate
-- institutional entry will just stay hidden (safe failure direction:
-- this can only under-show, never leak an actual citizen's name).
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
  case
    when lower(trim(name)) = any(array[
      'autosesizare',
      'politia locala', 'poliția locală', 'poliţia locală',
      'birou energetic'
    ]) then name
    else null
  end as public_name,
  submitted_on,
  resolved_on
from public.tickets
where archived = false;

comment on view public.public_tickets is
  'Public-safe view: no phone/email/description, address kept exact. `name` is hidden unless it is one of a small set of institutional sources (Autosesizare / Poliția locală / Birou energetic) -- see public_name. Underlying `tickets` table RLS must continue to deny anon direct access entirely -- this view is the only public-facing surface.';

grant select on public.public_tickets to anon, authenticated;
