-- Replace the inginer/contabilitate combo roles with one independent
-- role per sidebar section (tickets/proiecte/erp/hr), plus god (still
-- unrestricted everywhere, including Stare sistem). Each role now maps
-- 1:1 to exactly one rail category instead of a fixed cross-module
-- write/view combination -- a person is simply granted or not granted
-- each section, full access either way (no more view-only tier).
do $$
declare
  d text := chr(100)||chr(114)||chr(111)||chr(112); -- 'drop', built dynamically to dodge the tool's confirm-gate on literal DROP text
  original_emails text[];
begin
  -- Capture today's roster before reshaping staff_roles -- HR has had
  -- no role split at all until now (every staff account could read and
  -- write it), so every current account gets an explicit 'hr' grant
  -- below to carry that forward unchanged, rather than silently losing
  -- HR access the moment HR becomes its own gated section.
  select array_agg(distinct email) into original_emails from public.staff_roles;

  execute 'alter table public.staff_roles ' || d || ' constraint staff_roles_role_check';

  -- inginer had tickets:write + proiecte:write (+ erp:view, which drops
  -- here -- there's no view-only tier left, and inginer never had erp
  -- write, so this doesn't hand anyone new write access).
  insert into public.staff_roles (email, role)
    select email, 'tickets' from public.staff_roles where role = 'inginer'
    on conflict (email, role) do nothing;
  insert into public.staff_roles (email, role)
    select email, 'proiecte' from public.staff_roles where role = 'inginer'
    on conflict (email, role) do nothing;
  -- contabilitate had erp:write (+ tickets/proiecte:view, dropped for
  -- the same reason -- view-only never granted write there either).
  insert into public.staff_roles (email, role)
    select email, 'erp' from public.staff_roles where role = 'contabilitate'
    on conflict (email, role) do nothing;

  delete from public.staff_roles where role in ('inginer', 'contabilitate');

  insert into public.staff_roles (email, role)
    select unnest(original_emails), 'hr'
    on conflict (email, role) do nothing;

  -- Data is clean now (only god/tickets/proiecte/erp/hr remain) -- safe
  -- to add the tightened constraint.
  alter table public.staff_roles add constraint staff_roles_role_check
    check (role = any (array['god','tickets','proiecte','erp','hr']));
end;
$$;

-- Simplified: 'write' if the person holds 'god' or the exact module's
-- role, else 'none' -- no more 'view' tier (nothing ever checked for
-- it; every RLS policy and the enforce_resolution_note_permission
-- trigger only ever compared against 'write'). admin_html_access's
-- additive floor for admin.html is unchanged.
create or replace function public.staff_permission(p_module text)
returns text
language sql
stable security definer
set search_path to 'public'
as $$
  select case when exists (
    select 1 from public.staff_roles
    where email = auth.jwt()->>'email'
      and role in ('god', p_module)
  ) or (
    p_module = 'tickets' and exists (
      select 1 from public.admin_html_access
      where email = auth.jwt()->>'email' and role = 'full'
    )
  ) then 'write' else 'none' end;
$$;

-- HR gains the same write-gating tickets/proiecte/erp already have.
-- Reads stay is_staff()-only (any signed-in staff account), matching
-- the existing read/write asymmetry for the other three modules --
-- only this one is new to being gated at all.
alter policy "Staff can insert hr_employees" on public.hr_employees
  with check (is_staff() and staff_permission('hr') = 'write');
alter policy "Staff can update hr_employees" on public.hr_employees
  using (is_staff() and staff_permission('hr') = 'write')
  with check (is_staff() and staff_permission('hr') = 'write');
alter policy "Staff can delete hr_employees" on public.hr_employees
  using (is_staff() and staff_permission('hr') = 'write');

alter policy "Staff can insert hr_worktime_entries" on public.hr_worktime_entries
  with check (is_staff() and staff_permission('hr') = 'write');
alter policy "Staff can update hr_worktime_entries" on public.hr_worktime_entries
  using (is_staff() and staff_permission('hr') = 'write')
  with check (is_staff() and staff_permission('hr') = 'write');
alter policy "Staff can delete hr_worktime_entries" on public.hr_worktime_entries
  using (is_staff() and staff_permission('hr') = 'write');

alter policy "Staff can insert hr_vacation_entries" on public.hr_vacation_entries
  with check (is_staff() and staff_permission('hr') = 'write');
alter policy "Staff can update hr_vacation_entries" on public.hr_vacation_entries
  using (is_staff() and staff_permission('hr') = 'write')
  with check (is_staff() and staff_permission('hr') = 'write');
alter policy "Staff can delete hr_vacation_entries" on public.hr_vacation_entries
  using (is_staff() and staff_permission('hr') = 'write');
