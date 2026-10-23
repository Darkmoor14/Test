-- Public pages use the deliberately limited public_tickets projection.
-- Do not let anon query the underlying ticket table, which contains
-- reporters' direct contact details and free-text submissions.
revoke all on table public.tickets from anon;
drop policy if exists "Public can view non-archived tickets" on public.tickets;

-- Keep only fields intended for the public status pages. In particular,
-- omit description: it is free text and may contain personal information.
drop view if exists public.public_tickets;
create view public.public_tickets
with (security_invoker = false, security_barrier = true)
as
select
  id,
  ticket_number,
  type,
  address,
  status,
  submitted_on,
  resolved_on,
  case
    when translate(lower(coalesce(name, '')), 'ăâîșțşţ', 'aaistst') like '%politia%'
      and translate(lower(coalesce(name, '')), 'ăâîșțşţ', 'aaistst') like '%locala%' then name
    when translate(lower(coalesce(name, '')), 'ăâîșțşţ', 'aaistst') like '%birou%'
      and translate(lower(coalesce(name, '')), 'ăâîșțşţ', 'aaistst') like '%energetic%' then name
    when translate(lower(coalesce(name, '')), 'ăâîșțşţ', 'aaistst') like '%autosesizare%' then name
    else null
  end as public_name
from public.tickets
where archived = false;

grant select on table public.public_tickets to anon, authenticated;

comment on view public.public_tickets is
  'Public status feed. Deliberately excludes phone, email, reporter name except whitelisted institutional sources, and free-text description.';
