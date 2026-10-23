-- Public pages read tickets through this deliberately limited projection.
-- The view runs with invoker security so it obeys the same RLS policy and
-- column grants as a direct anon query, instead of bypassing them with
-- view-owner privileges. Reporter contact details and free-text
-- descriptions are never exposed; the reporter name is surfaced only for
-- whitelisted institutional sources, via a generated public_name column.

alter table public.tickets
  add column if not exists public_name text
  generated always as (
    case
      when translate(lower(coalesce(name, '')), 'ăâîșțşţ', 'aaistst') like '%politia%'
        and translate(lower(coalesce(name, '')), 'ăâîșțşţ', 'aaistst') like '%locala%' then name
      when translate(lower(coalesce(name, '')), 'ăâîșțşţ', 'aaistst') like '%birou%'
        and translate(lower(coalesce(name, '')), 'ăâîșțşţ', 'aaistst') like '%energetic%' then name
      when translate(lower(coalesce(name, '')), 'ăâîșțşţ', 'aaistst') like '%autosesizare%' then name
      else null
    end
  ) stored;

drop policy if exists "Public can view non-archived tickets" on public.tickets;
create policy "Public can view non-archived tickets"
  on public.tickets
  for select
  to anon
  using (archived = false);

revoke all on table public.tickets from anon;
grant select (
  id, ticket_number, type, address, status,
  submitted_on, resolved_on, public_name
) on public.tickets to anon;

create or replace view public.public_tickets
with (security_invoker = true, security_barrier = true)
as
select
  id, ticket_number, type, address, status,
  submitted_on, resolved_on, public_name
from public.tickets;

grant select on table public.public_tickets to anon, authenticated;

comment on view public.public_tickets is
  'Public status feed using invoker RLS and column-level grants. Excludes contact details, reporter names except whitelisted institutional sources, and free-text descriptions.';
