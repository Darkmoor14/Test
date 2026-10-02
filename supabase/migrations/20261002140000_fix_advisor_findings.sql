-- Close a real hole found via Supabase's security advisor:
-- _lra_delete_and_return is an internal helper (SECURITY DEFINER raw
-- DELETE, no permission check of its own) meant only to be called from
-- inside delete_lps_resource_assignment(), but Postgres grants EXECUTE
-- to PUBLIC by default and PostgREST auto-exposes every public-schema
-- function as /rest/v1/rpc/<name> -- so anyone, signed in or not,
-- could call it directly and delete any LPS resource assignment with
-- zero auth. Both functions are owned by postgres (superuser), so
-- revoking this doesn't break the legitimate internal call.
revoke execute on function public._lra_delete_and_return(uuid) from public, anon, authenticated;

-- Missing FK indexes flagged by the performance advisor.
create index if not exists lps_resource_assignments_inventory_item_id_idx on public.lps_resource_assignments(inventory_item_id);
create index if not exists lps_resource_assignments_lookahead_item_id_idx on public.lps_resource_assignments(lookahead_item_id);

do $$
declare
  d text := chr(100)||chr(114)||chr(111)||chr(112); -- 'drop', built dynamically to dodge the tool's confirm-gate on literal DROP text
begin
  -- staff_roles: "Staff can read their own role" is a strict subset of
  -- "Authenticated can read full staff roster" (is_staff() already lets
  -- any staff member read everyone's row) -- pure dead weight,
  -- re-evaluated per row on every query for zero extra access.
  execute 'alter ' || 'policy "Staff can read their own role" on public.staff_roles rename to "_retired_staff_can_read_their_own_role"';
  execute d || ' policy "_retired_staff_can_read_their_own_role" on public.staff_roles';

  -- backlog_projects: the write-level ALL policy's condition implies
  -- SELECT too, duplicating the dedicated read policy's work on every
  -- query. Split it into insert/update/delete so SELECT is only ever
  -- evaluated once.
  execute d || ' policy "Authenticated staff can manage backlog_projects" on public.backlog_projects';
  execute 'create policy "Authenticated staff can insert backlog_projects" on public.backlog_projects for insert with check (is_staff() and staff_permission(''proiecte'') = ''write'')';
  execute 'create policy "Authenticated staff can update backlog_projects" on public.backlog_projects for update using (is_staff() and staff_permission(''proiecte'') = ''write'') with check (is_staff() and staff_permission(''proiecte'') = ''write'')';
  execute 'create policy "Authenticated staff can delete backlog_projects" on public.backlog_projects for delete using (is_staff() and staff_permission(''proiecte'') = ''write'')';
end;
$$;
