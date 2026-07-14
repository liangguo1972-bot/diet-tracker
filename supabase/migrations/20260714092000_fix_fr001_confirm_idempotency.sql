-- Check the idempotency record before an already-confirmed import is handled.
-- This makes retries return the original result and rejects key reuse with a
-- changed request deterministically.

create or replace function public.confirm_receipt_import(
  p_receipt_import_id uuid,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_import public.receipt_imports%rowtype;
  v_item public.receipt_items%rowtype;
  v_hash text;
  v_existing_hash text;
  v_existing_response jsonb;
  v_inventory_id uuid;
  v_count integer := 0;
  v_unit_kind text;
  v_grams_per_unit numeric;
  v_response jsonb;
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;
  if p_receipt_import_id is null or p_idempotency_key is null then
    raise exception 'QUANTITY_INVALID' using errcode = '22023';
  end if;
  select * into v_import from public.receipt_imports
  where id = p_receipt_import_id and user_id = v_user_id for update;
  if not found then
    raise exception 'INVALID_REFERENCE' using errcode = 'P0001';
  end if;
  v_hash := md5(jsonb_build_object(
    'receiptImportId', v_import.id,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', id, 'ingredientId', ingredient_id, 'confirmedName', confirmed_name,
        'confirmedQuantity', confirmed_quantity, 'confirmedUnit', confirmed_unit,
        'storage', storage, 'action', action
      ) order by position)
      from public.receipt_items where receipt_import_id = v_import.id
    ), '[]'::jsonb)
  )::text);
  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text || ':confirm_receipt_import:' || p_idempotency_key::text, 0));
  select request_hash, response into v_existing_hash, v_existing_response
  from public.operation_requests
  where user_id = v_user_id and operation_type = 'confirm_receipt_import' and idempotency_key = p_idempotency_key;
  if found then
    if v_existing_hash <> v_hash then
      raise exception 'IDEMPOTENCY_CONFLICT' using errcode = 'P0001';
    end if;
    return v_existing_response;
  end if;
  if v_import.status <> 'ready_for_review' then
    raise exception 'STATUS_CONFLICT' using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from public.receipt_items where receipt_import_id = v_import.id and action = 'add_to_inventory'
  ) then
    raise exception 'QUANTITY_INVALID' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.receipt_items
    where receipt_import_id = v_import.id and action = 'add_to_inventory'
      and (confirmed_name is null or confirmed_quantity is null or confirmed_quantity <= 0 or confirmed_unit is null)
  ) then
    raise exception 'QUANTITY_INVALID' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.receipt_items ritem
    left join public.ingredients ing on ing.id = ritem.ingredient_id
    where ritem.receipt_import_id = v_import.id and ritem.ingredient_id is not null
      and (ing.id is null or ing.user_id <> v_user_id)
  ) then
    raise exception 'INVALID_REFERENCE' using errcode = 'P0001';
  end if;
  insert into public.operation_requests (user_id, operation_type, idempotency_key, request_hash)
  values (v_user_id, 'confirm_receipt_import', p_idempotency_key, v_hash);

  for v_item in select * from public.receipt_items
    where receipt_import_id = v_import.id and action = 'add_to_inventory' order by position
  loop
    v_unit_kind := case
      when v_item.confirmed_unit = 'g' then 'weight'
      when v_item.confirmed_unit in ('个', '只', '片', '根') then 'count'
      when v_item.confirmed_unit in ('盒', '袋', '瓶', '包') then 'container'
      when v_item.confirmed_unit in ('把', '碗', '份') then 'portion'
      else 'other'
    end;
    v_grams_per_unit := case when v_item.confirmed_unit = 'g' then 1 else null end;
    insert into public.inventory (
      user_id, ingredient_id, receipt_item_id, quantity, unit, unit_kind, grams_per_unit,
      display_name, storage, purchase_date, status, receipt_raw_name, price, note
    ) values (
      v_user_id, v_item.ingredient_id, v_item.id, v_item.confirmed_quantity, v_item.confirmed_unit,
      v_unit_kind, v_grams_per_unit, v_item.confirmed_name, v_item.storage,
      coalesce(v_import.purchased_on, current_date), 'active', v_item.raw_name, v_item.raw_price,
      '小票导入 ' || v_import.id::text
    ) returning id into v_inventory_id;
    update public.receipt_items set inventory_id = v_inventory_id, updated_at = now() where id = v_item.id;
    insert into public.inventory_movements (user_id, inventory_id, movement_type, quantity_delta, unit, note)
    values (v_user_id, v_inventory_id, 'purchase', v_item.confirmed_quantity, v_item.confirmed_unit,
      '小票导入 ' || v_import.id::text);
    if v_item.ingredient_id is not null then
      insert into public.ingredient_aliases (user_id, ingredient_id, alias, normalized_alias)
      values (v_user_id, v_item.ingredient_id, v_item.raw_name, public.normalize_receipt_name(v_item.raw_name))
      on conflict (user_id, normalized_alias) do update
        set ingredient_id = excluded.ingredient_id, alias = excluded.alias, updated_at = now();
    end if;
    v_count := v_count + 1;
  end loop;
  update public.receipt_imports set status = 'confirmed', confirmed_at = now(), error_code = null,
    error_message = null, updated_at = now() where id = v_import.id;
  v_response := jsonb_build_object(
    'receiptImportId', v_import.id, 'status', 'confirmed', 'inventoryCount', v_count, 'alreadyConfirmed', false
  );
  update public.operation_requests set response = v_response, updated_at = now()
  where user_id = v_user_id and operation_type = 'confirm_receipt_import' and idempotency_key = p_idempotency_key;
  return v_response;
end;
$$;

revoke all on function public.confirm_receipt_import(uuid, uuid) from public, anon;
grant execute on function public.confirm_receipt_import(uuid, uuid) to authenticated;
