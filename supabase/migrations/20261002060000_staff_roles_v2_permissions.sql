-- ============================================================
-- STAFF ROLES v2 — replace the old generic 'full'/'limited' pair
-- with three named roles, each with its own per-module view/write
-- permissions, managed from the new "Roluri" tab (Stare sistem) in
-- admin-3.html instead of hand-editing rows in the SQL editor.
--
--   god            — full access everywhere (tickets, proiecte, erp,
--                    and Stare sistem itself).
--   inginer        — tickets: write, proiecte: write, erp: view only.
--                    Stare sistem hidden entirely.
--   contabilitate  — tickets: view only, proiecte: view only,
--                    erp: write. Stare sistem hidden entirely.
--
-- "Stare sistem" isn't a data module with its own table, so there's
-- no DB-level gate for it — admin-3.html simply doesn't render that
-- rail category/sidebar section unless the signed-in role is 'god'.
-- Everything else here is enforced at the RLS layer, same as before.
-- ============================================================

-- 1) Drop the old CHECK first -- it only allows 'limited'/'full', so
--    the data migration below would violate it otherwise. 'full' was
--    always unrestricted -> 'god'. 'limited' was a vaguer "can see
--    things, can't edit everything" role with no clean equivalent ->
--    defaults to 'inginer' as a starting point; review and adjust
--    each person's actual role from the new Roluri tab.
alter table public.staff_roles drop constraint staff_roles_role_check;

update public.staff_roles set role = 'god' where role = 'full';
update public.staff_roles set role = 'inginer' where role = 'limited';

alter table public.staff_roles add constraint staff_roles_role_check
  check (role = any (array['inginer'::text, 'contabilitate'::text, 'god'::text]));

-- 2) staff_permission(module) -> 'write' | 'view' | 'none', for
--    module in ('tickets', 'proiecte', 'erp'). RLS policies below
--    call this instead of hardcoding role names, so adding a 4th
--    role later only means editing this one function.
create or replace function public.staff_permission(p_module text)
returns text
language sql
stable
security definer
set search_path to 'public'
as $$
  select case (select role from public.staff_roles where email = auth.jwt()->>'email')
    when 'god' then 'write'
    when 'inginer' then case p_module when 'erp' then 'view' else 'write' end
    when 'contabilitate' then case p_module when 'erp' then 'write' else 'view' end
    else 'none'
  end;
$$;

-- 3) Tighten write policies on each module's tables. SELECT stays
--    plain is_staff() -- every role at least views every module, so
--    there's no 'none' case to gate reads on here.

-- --- tickets (module: tickets) ---
drop policy if exists "Authenticated can update tickets" on public.tickets;
create policy "Authenticated can update tickets" on public.tickets
  for update
  using (is_staff() and staff_permission('tickets') = 'write')
  with check (is_staff() and staff_permission('tickets') = 'write');

-- --- current_projects / backlog_projects / work_orders /
--     lps_lookahead_items (module: proiecte) ---
drop policy if exists "Authenticated can insert current projects" on public.current_projects;
create policy "Authenticated can insert current projects" on public.current_projects
  for insert
  with check (is_staff() and staff_permission('proiecte') = 'write');
drop policy if exists "Authenticated can update current projects" on public.current_projects;
create policy "Authenticated can update current projects" on public.current_projects
  for update
  using (is_staff() and staff_permission('proiecte') = 'write')
  with check (is_staff() and staff_permission('proiecte') = 'write');
drop policy if exists "Authenticated can delete current projects" on public.current_projects;
create policy "Authenticated can delete current projects" on public.current_projects
  for delete
  using (is_staff() and staff_permission('proiecte') = 'write');

-- backlog_projects had one catch-all "ALL" policy covering read too --
-- split so SELECT stays plain is_staff() and only writes get gated.
drop policy if exists "Authenticated staff can manage backlog_projects" on public.backlog_projects;
create policy "Authenticated can read backlog_projects" on public.backlog_projects
  for select
  using (is_staff());
create policy "Authenticated can insert backlog_projects" on public.backlog_projects
  for insert
  with check (is_staff() and staff_permission('proiecte') = 'write');
create policy "Authenticated can update backlog_projects" on public.backlog_projects
  for update
  using (is_staff() and staff_permission('proiecte') = 'write')
  with check (is_staff() and staff_permission('proiecte') = 'write');
create policy "Authenticated can delete backlog_projects" on public.backlog_projects
  for delete
  using (is_staff() and staff_permission('proiecte') = 'write');

drop policy if exists "Authenticated can insert work_orders" on public.work_orders;
create policy "Authenticated can insert work_orders" on public.work_orders
  for insert
  with check (is_staff() and staff_permission('proiecte') = 'write');
drop policy if exists "Authenticated can update work_orders" on public.work_orders;
create policy "Authenticated can update work_orders" on public.work_orders
  for update
  using (is_staff() and staff_permission('proiecte') = 'write')
  with check (is_staff() and staff_permission('proiecte') = 'write');
drop policy if exists "Authenticated can delete work_orders" on public.work_orders;
create policy "Authenticated can delete work_orders" on public.work_orders
  for delete
  using (is_staff() and staff_permission('proiecte') = 'write');

drop policy if exists "Authenticated can insert lps_lookahead_items" on public.lps_lookahead_items;
create policy "Authenticated can insert lps_lookahead_items" on public.lps_lookahead_items
  for insert
  with check (is_staff() and staff_permission('proiecte') = 'write');
drop policy if exists "Authenticated can update lps_lookahead_items" on public.lps_lookahead_items;
create policy "Authenticated can update lps_lookahead_items" on public.lps_lookahead_items
  for update
  using (is_staff() and staff_permission('proiecte') = 'write')
  with check (is_staff() and staff_permission('proiecte') = 'write');
drop policy if exists "Authenticated can delete lps_lookahead_items" on public.lps_lookahead_items;
create policy "Authenticated can delete lps_lookahead_items" on public.lps_lookahead_items
  for delete
  using (is_staff() and staff_permission('proiecte') = 'write');

-- --- equipment_inventory (module: erp) ---
-- Deliberately NOT gating lps_resource_assignments / stock_ledger by
-- 'erp' permission here: reserving/returning material against a LPS
-- look-ahead item is a *proiecte* action that happens to touch
-- equipment_inventory's quantity as a side effect, not an ERP-module
-- edit in its own right -- see reserve_lps_material() /
-- delete_lps_resource_assignment() below, now made SECURITY DEFINER
-- specifically so that side-effect update isn't blocked by this
-- policy for an inginer (proiecte: write, erp: view only).
drop policy if exists "Authenticated can insert equipment_inventory" on public.equipment_inventory;
create policy "Authenticated can insert equipment_inventory" on public.equipment_inventory
  for insert
  with check (is_staff() and staff_permission('erp') = 'write');
drop policy if exists "Authenticated can update equipment_inventory" on public.equipment_inventory;
create policy "Authenticated can update equipment_inventory" on public.equipment_inventory
  for update
  using (is_staff() and staff_permission('erp') = 'write')
  with check (is_staff() and staff_permission('erp') = 'write');
drop policy if exists "Authenticated can delete equipment_inventory" on public.equipment_inventory;
create policy "Authenticated can delete equipment_inventory" on public.equipment_inventory
  for delete
  using (is_staff() and staff_permission('erp') = 'write');

-- 4) create_ticket() is SECURITY DEFINER, so it bypasses the tickets
--    RLS policy above entirely -- it needs its own explicit gate for
--    an authenticated (non-anonymous) caller without 'tickets' write.
--    Anonymous (public-form) submissions are untouched.
create or replace function public.create_ticket(p_type text, p_name text, p_phone text, p_email text, p_address text, p_description text, p_captcha_token text default null::text)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_is_anon boolean := auth.role() = 'anon';
  v_ticket_number text;
begin
  if v_is_anon then
    perform public.check_and_log_rate_limit();

    if not public.verify_captcha(p_captcha_token) then
      raise exception 'CAPTCHA verification failed. Please try again.'
        using errcode = 'P0001';
    end if;
  elsif public.staff_permission('tickets') <> 'write' then
    raise exception 'Nu aveți permisiunea de a adăuga sesizări.'
      using errcode = 'P0001';
  end if;

  insert into tickets (type, name, phone, email, address, description, created_via_public)
  values (p_type, p_name, p_phone, p_email, p_address, p_description, v_is_anon)
  returning ticket_number into v_ticket_number;

  return v_ticket_number;
end;
$function$;

-- 5) reserve_lps_material() / delete_lps_resource_assignment() ran as
--    the caller before (subject to equipment_inventory's own RLS),
--    which would now block an inginer (erp: view only) from a
--    legitimate proiecte action: reserving/returning LPS material.
--    Made SECURITY DEFINER with their own explicit proiecte-write
--    check, so they bypass the erp-scoped equipment_inventory policy
--    for just this one controlled update.
create or replace function public.reserve_lps_material(p_lookahead_item_id uuid, p_inventory_item_id uuid, p_quantity numeric, p_allow_overstock boolean default false)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_available numeric;
  v_item_type text;
  v_item_name text;
  v_assignment_id uuid;
  v_resulting_quantity numeric;
begin
  if not public.is_staff() or public.staff_permission('proiecte') <> 'write' then
    raise exception 'Nu aveți permisiunea de a rezerva materiale.';
  end if;

  if p_quantity is null or p_quantity <= 0 then
    raise exception 'Quantity must be greater than zero.';
  end if;

  perform 1 from public.lps_lookahead_items where id = p_lookahead_item_id;
  if not found then
    raise exception 'Look-ahead item not found.';
  end if;

  select quantity, item_type, name
    into v_available, v_item_type, v_item_name
    from public.equipment_inventory
   where id = p_inventory_item_id
   for update;
  if not found then
    raise exception 'Inventory item not found.';
  end if;
  if v_item_type <> 'material' then
    raise exception 'Only materials can be reserved by quantity.';
  end if;
  if v_available < p_quantity and not p_allow_overstock then
    raise exception 'Insufficient stock; explicit confirmation is required.';
  end if;

  v_resulting_quantity := v_available - p_quantity;
  update public.equipment_inventory
     set quantity = v_resulting_quantity, updated_at = now()
   where id = p_inventory_item_id;

  insert into public.lps_resource_assignments
    (lookahead_item_id, inventory_item_id, item_type, quantity, status)
  values
    (p_lookahead_item_id, p_inventory_item_id, 'material', p_quantity, 'reserved')
  returning id into v_assignment_id;

  insert into public.stock_ledger
    (item_id, item_name, change_qty, resulting_qty, reason, user_email)
  values
    (p_inventory_item_id, v_item_name, -p_quantity, v_resulting_quantity,
     'Rezervare LPS', auth.jwt() ->> 'email');

  return jsonb_build_object('assignment_id', v_assignment_id, 'quantity', v_resulting_quantity);
end;
$function$;

-- Split out as its own function: a plpgsql function body that contains
-- both a SELECT and a later DELETE FROM lps_resource_assignments
-- reproducibly hung the tooling used to apply this migration (not a
-- Postgres issue — a real, repeatable trigger worth documenting in
-- case it resurfaces). Isolating the delete here, called from
-- delete_lps_resource_assignment() below rather than inlined, avoids
-- it entirely.
create or replace function public._lra_delete_and_return(p_id uuid)
returns public.lps_resource_assignments
language sql
security definer
set search_path to 'public'
as $$
  delete from lps_resource_assignments where id = p_id returning *;
$$;

create or replace function public.delete_lps_resource_assignment(p_assignment_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_assignment public.lps_resource_assignments%rowtype;
  v_item_name text;
  v_resulting_quantity numeric;
begin
  if not public.is_staff() or public.staff_permission('proiecte') <> 'write' then
    raise exception 'Nu aveți permisiunea de a șterge rezervări.';
  end if;

  select * into v_assignment from public._lra_delete_and_return(p_assignment_id);
  if v_assignment.id is null then
    raise exception 'Resource assignment not found.';
  end if;

  if v_assignment.status = 'reserved'
     and v_assignment.item_type = 'material'
     and coalesce(v_assignment.quantity, 0) > 0 then
    select name into v_item_name
      from public.equipment_inventory
     where id = v_assignment.inventory_item_id
     for update;
    if not found then
      raise exception 'Reserved material no longer exists in inventory.';
    end if;

    update public.equipment_inventory
       set quantity = quantity + v_assignment.quantity, updated_at = now()
     where id = v_assignment.inventory_item_id
     returning quantity into v_resulting_quantity;

    insert into public.stock_ledger
      (item_id, item_name, change_qty, resulting_qty, reason, user_email)
    values
      (v_assignment.inventory_item_id, v_item_name, v_assignment.quantity,
       v_resulting_quantity, 'Returnare — ștergere rezervare', auth.jwt() ->> 'email');
  end if;

  return jsonb_build_object('deleted', true, 'restored_quantity', v_resulting_quantity);
end;
$function$;

-- 6a) push_subscriptions has never recorded *who* a device belongs to
--     (endpoint/keys only) -- there was no way to show "notifications
--     on/off" per person for the new Roluri tab. Nullable: existing
--     rows stay unmatched until that device re-subscribes.
alter table public.push_subscriptions add column if not exists user_email text;

-- 6b) Unrelated pre-existing bug, fixed while touching this area:
--    entity_log's own entity_type CHECK never allowed the ERP values
--    ('echipament'/'masina'/'material') that erp.js's logEntityActivity
--    has always tried to insert -- every ERP activity-log write has
--    been silently failing (caught, swallowed) since that code shipped.
alter table public.entity_log drop constraint entity_log_entity_type_check;
alter table public.entity_log add constraint entity_log_entity_type_check
  check (entity_type = any (array['project'::text, 'backlog'::text, 'lookahead'::text, 'echipament'::text, 'masina'::text, 'material'::text]));

-- 7) staff_roles management from the client (new "Roluri" tab). SELECT
--    was already staff-wide (needed for the calendar's "assign to"
--    picker) -- there was never an INSERT/UPDATE/DELETE policy at
--    all, so role changes have only ever been possible by hand in the
--    SQL editor. Add write access, restricted to 'god' (the only role
--    that can see the Roluri tab in the first place).
create or replace function public.is_god()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce((select role from public.staff_roles where email = auth.jwt()->>'email') = 'god', false);
$$;

create policy "God can insert staff_roles" on public.staff_roles
  for insert
  with check (is_god());
create policy "God can update staff_roles" on public.staff_roles
  for update
  using (is_god())
  with check (is_god());
create policy "God can delete staff_roles" on public.staff_roles
  for delete
  using (is_god());
