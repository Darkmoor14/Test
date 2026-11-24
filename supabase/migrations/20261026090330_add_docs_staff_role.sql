-- Documentație moves out from under HR's rail icon to become its own
-- top-level section with its own independent role, same as
-- tickets/proiecte/erp/hr -- see 20261012055048_staff_roles_per_section_access
-- for how that one-role-per-section model was set up. Nothing in
-- Documentație itself gates an RLS-protected table (it's a static
-- guide page), so this only widens the role_check constraint and lets
-- Roles.tsx grant/revoke it; staff_permission('docs') exists for
-- parity with every other module even though nothing currently reads it.
alter table public.staff_roles drop constraint staff_roles_role_check;
alter table public.staff_roles add constraint staff_roles_role_check
  check (role = any (array['god','tickets','proiecte','erp','hr','docs']));
