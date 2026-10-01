-- Keep stock, LPS reservations, and the stock ledger consistent as one transaction.
-- SECURITY INVOKER keeps the existing RLS policies in force for the caller.
create or replace function public.reserve_lps_material(
  p_lookahead_item_id uuid,
  p_inventory_item_id uuid,
  p_quantity numeric,
  p_allow_overstock boolean default false
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_available numeric;
  v_item_type text;
  v_item_name text;
  v_assignment_id uuid;
  v_resulting_quantity numeric;
begin
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

create or replace function public.delete_lps_resource_assignment(p_assignment_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_assignment public.lps_resource_assignments%rowtype;
  v_item_name text;
  v_resulting_quantity numeric;
begin
  select * into v_assignment
    from public.lps_resource_assignments
   where id = p_assignment_id
   for update;
  if not found then
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

  delete from public.lps_resource_assignments where id = p_assignment_id;
  return jsonb_build_object('deleted', true, 'restored_quantity', v_resulting_quantity);
end;
$function$;

revoke all on function public.reserve_lps_material(uuid, uuid, numeric, boolean) from public, anon;
revoke all on function public.delete_lps_resource_assignment(uuid) from public, anon;
grant execute on function public.reserve_lps_material(uuid, uuid, numeric, boolean) to authenticated;
grant execute on function public.delete_lps_resource_assignment(uuid) to authenticated;
