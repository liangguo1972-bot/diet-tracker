-- FR-001 receipt review contract hardening.
-- Unreliable OCR quantities default to one generic inventory item. Storage
-- locations are limited to the three product-approved values.

update public.receipt_items
set confirmed_quantity = case
      when nullif(btrim(confirmed_unit), '') is null then 1
      when confirmed_quantity is null or confirmed_quantity <= 0 then 1
      else confirmed_quantity
    end,
    confirmed_unit = coalesce(nullif(btrim(confirmed_unit), ''), '件'),
    updated_at = now()
where action = 'add_to_inventory'
  and (confirmed_quantity is null or confirmed_quantity <= 0 or nullif(btrim(confirmed_unit), '') is null);

alter table public.receipt_items
  add constraint receipt_items_confirmed_quantity_positive
    check (confirmed_quantity is null or confirmed_quantity > 0),
  add constraint receipt_items_storage_check
    check (storage is null or storage in ('常温', '冷藏', '冷冻'));

alter table public.inventory
  add constraint inventory_storage_check
    check (storage is null or storage in ('常温', '冷藏', '冷冻'));

alter table public.shopping_list_items
  add constraint shopping_list_items_storage_check
    check (storage is null or storage in ('常温', '冷藏', '冷冻'));

create or replace function public.search_receipt_ingredients(p_query text default '')
returns table (
  ingredient_id uuid,
  name text,
  category text,
  package_spec text,
  storage_guidance text,
  is_verified boolean
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_query text := btrim(coalesce(p_query, ''));
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;
  if length(v_query) > 100 then
    raise exception 'QUANTITY_INVALID' using errcode = '22023';
  end if;

  return query
  select i.id, i.name, i.category, i.package_spec, i.storage, coalesce(i.is_verified, false)
  from public.ingredients i
  where i.user_id = v_user_id
    and (
      v_query = ''
      or i.name ilike '%' || v_query || '%'
      or coalesce(i.category, '') ilike '%' || v_query || '%'
      or coalesce(i.package_spec, '') ilike '%' || v_query || '%'
    )
  order by
    case when lower(i.name) = lower(v_query) then 0 else 1 end,
    i.name
  limit 30;
end;
$$;

create or replace function public.apply_receipt_recognition(
  p_receipt_import_id uuid,
  p_raw_text text,
  p_items jsonb,
  p_provider text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_import public.receipt_imports%rowtype;
  v_item jsonb;
  v_position integer := 0;
  v_raw_name text;
  v_raw_quantity numeric;
  v_raw_unit text;
  v_raw_price numeric;
  v_confirmed_quantity numeric;
  v_confirmed_unit text;
  v_quantity_reliable boolean;
  v_ingredient_id uuid;
  v_match_status text;
  v_confidence numeric;
  v_normalized text;
begin
  if p_receipt_import_id is null or p_items is null or jsonb_typeof(p_items) <> 'array'
     or nullif(btrim(p_provider), '') is null then
    raise exception 'RECEIPT_RECOGNITION_INVALID' using errcode = '22023';
  end if;
  select * into v_import from public.receipt_imports where id = p_receipt_import_id for update;
  if not found then
    raise exception 'INVALID_REFERENCE' using errcode = 'P0001';
  end if;
  if v_import.status not in ('uploaded', 'processing', 'failed') then
    raise exception 'STATUS_CONFLICT' using errcode = 'P0001';
  end if;

  delete from public.receipt_items where receipt_import_id = v_import.id;
  for v_item in select value from jsonb_array_elements(p_items)
  loop
    begin
      v_raw_name := nullif(btrim(v_item ->> 'name'), '');
      v_raw_quantity := nullif(v_item ->> 'quantity', '')::numeric;
      v_raw_unit := nullif(btrim(v_item ->> 'unit'), '');
      v_raw_price := nullif(v_item ->> 'price', '')::numeric;
    exception when others then
      raise exception 'RECEIPT_RECOGNITION_INVALID' using errcode = '22023';
    end;
    if v_raw_name is null then
      raise exception 'RECEIPT_RECOGNITION_INVALID' using errcode = '22023';
    end if;
    if v_raw_quantity is not null and v_raw_quantity <= 0 then
      v_raw_quantity := null;
    end if;

    -- A quantity without a unit is ambiguous on a receipt. It can be a price,
    -- weight or count. Keep it as raw OCR evidence, but do not copy it into the
    -- inventory draft. Equal quantity and price values are also treated as
    -- unreliable even when the provider supplied a unit.
    v_quantity_reliable := v_raw_quantity is not null
      and v_raw_unit is not null
      and (v_raw_price is null or abs(v_raw_quantity - v_raw_price) > 0.000001);
    if v_quantity_reliable then
      v_confirmed_quantity := v_raw_quantity;
      v_confirmed_unit := v_raw_unit;
    else
      v_confirmed_quantity := 1;
      v_confirmed_unit := '件';
    end if;

    v_normalized := public.normalize_receipt_name(v_raw_name);
    v_ingredient_id := null;
    v_match_status := 'unmatched';
    v_confidence := null;
    if v_normalized is not null then
      select ia.ingredient_id into v_ingredient_id
      from public.ingredient_aliases ia
      where ia.user_id = v_import.user_id and ia.normalized_alias = v_normalized;
      if found then
        -- An exact user-confirmed alias is trusted. A different product name,
        -- including a nutrition-sensitive variant, will not hit this branch.
        v_match_status := 'matched';
        v_confidence := 1;
      else
        select i.id into v_ingredient_id
        from public.ingredients i
        where i.user_id = v_import.user_id
          and public.normalize_receipt_name(i.name) = v_normalized
        order by i.name
        limit 1;
        if found then
          v_match_status := 'matched';
          v_confidence := 0.95;
        else
          select i.id into v_ingredient_id
          from public.ingredients i
          where i.user_id = v_import.user_id
            and (public.normalize_receipt_name(i.name) like '%' || v_normalized || '%'
                 or v_normalized like '%' || public.normalize_receipt_name(i.name) || '%')
          order by length(i.name), i.name
          limit 1;
          if found then
            -- Fuzzy and broader-name matches always require explicit review.
            v_match_status := 'possible_match';
            v_confidence := 0.5;
          end if;
        end if;
      end if;
    end if;

    insert into public.receipt_items (
      receipt_import_id, position, raw_line, raw_name, raw_quantity, raw_unit, raw_price,
      ingredient_id, match_status, match_confidence, confirmed_name, confirmed_quantity, confirmed_unit
    ) values (
      v_import.id, v_position, nullif(btrim(v_item ->> 'line'), ''), v_raw_name,
      v_raw_quantity, v_raw_unit, v_raw_price, v_ingredient_id, v_match_status, v_confidence,
      v_raw_name, v_confirmed_quantity, v_confirmed_unit
    );
    v_position := v_position + 1;
  end loop;

  update public.receipt_imports
  set status = 'ready_for_review', recognition_provider = btrim(p_provider), raw_text = p_raw_text,
      error_code = null, error_message = null, updated_at = now()
  where id = v_import.id;
  return jsonb_build_object('receiptImportId', v_import.id, 'status', 'ready_for_review', 'itemCount', v_position);
end;
$$;

create or replace function public.update_receipt_items(
  p_receipt_import_id uuid,
  p_items jsonb
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
  v_item jsonb;
  v_item_id uuid;
  v_ingredient_id uuid;
  v_action text;
  v_name text;
  v_quantity numeric;
  v_unit text;
  v_storage text;
  v_count integer := 0;
  v_seen_ids uuid[] := '{}'::uuid[];
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;
  if p_receipt_import_id is null or p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'RECEIPT_ITEMS_INVALID' using errcode = '22023';
  end if;
  select * into v_import from public.receipt_imports
  where id = p_receipt_import_id and user_id = v_user_id for update;
  if not found then
    raise exception 'INVALID_REFERENCE' using errcode = 'P0001';
  end if;
  if v_import.status <> 'ready_for_review' then
    raise exception 'STATUS_CONFLICT' using errcode = 'P0001';
  end if;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    begin
      v_item_id := (v_item ->> 'receiptItemId')::uuid;
      v_ingredient_id := nullif(v_item ->> 'ingredientId', '')::uuid;
      v_action := coalesce(nullif(btrim(v_item ->> 'action'), ''), 'add_to_inventory');
      v_name := nullif(btrim(v_item ->> 'confirmedName'), '');
      v_unit := nullif(btrim(v_item ->> 'confirmedUnit'), '');
      v_storage := nullif(btrim(v_item ->> 'storage'), '');
    exception when others then
      raise exception 'RECEIPT_ITEMS_INVALID' using errcode = '22023';
    end;
    if v_item_id is null or v_action not in ('add_to_inventory', 'ignore') then
      raise exception 'RECEIPT_ITEMS_INVALID' using errcode = '22023';
    end if;
    if v_item_id = any(v_seen_ids) then
      raise exception 'RECEIPT_ITEMS_INVALID' using errcode = '22023',
        detail = jsonb_build_object('receiptItemId', v_item_id, 'field', 'receiptItemId')::text;
    end if;
    v_seen_ids := array_append(v_seen_ids, v_item_id);
    if not exists (
      select 1 from public.receipt_items where id = v_item_id and receipt_import_id = v_import.id
    ) then
      raise exception 'INVALID_REFERENCE' using errcode = 'P0001';
    end if;

    if v_action = 'add_to_inventory' then
      if v_name is null then
        raise exception 'RECEIPT_ITEM_NAME_REQUIRED' using errcode = '22023',
          detail = jsonb_build_object('receiptItemId', v_item_id, 'field', 'confirmedName')::text;
      end if;
      if v_storage is null or v_storage not in ('常温', '冷藏', '冷冻') then
        raise exception 'RECEIPT_ITEM_STORAGE_INVALID' using errcode = '22023',
          detail = jsonb_build_object('receiptItemId', v_item_id, 'field', 'storage')::text;
      end if;
      if v_unit is null then
        -- When the unit is omitted, discard any ambiguous client quantity and
        -- use the same conservative backend-owned fallback as OCR drafts.
        v_quantity := 1;
        v_unit := '件';
      else
        begin
          v_quantity := coalesce(nullif(v_item ->> 'confirmedQuantity', '')::numeric, 1);
        exception when others then
          raise exception 'RECEIPT_ITEM_QUANTITY_INVALID' using errcode = '22023',
            detail = jsonb_build_object('receiptItemId', v_item_id, 'field', 'confirmedQuantity')::text;
        end;
        if v_quantity <= 0 then
          raise exception 'RECEIPT_ITEM_QUANTITY_INVALID' using errcode = '22023',
            detail = jsonb_build_object('receiptItemId', v_item_id, 'field', 'confirmedQuantity')::text;
        end if;
      end if;
      if v_ingredient_id is not null and not exists (
        select 1 from public.ingredients where id = v_ingredient_id and user_id = v_user_id
      ) then
        raise exception 'INVALID_REFERENCE' using errcode = 'P0001';
      end if;
    else
      v_ingredient_id := null;
      v_name := null;
      v_quantity := null;
      v_unit := null;
      v_storage := null;
    end if;

    update public.receipt_items
    set ingredient_id = v_ingredient_id,
        match_status = case when v_action = 'ignore' then 'ignored' when v_ingredient_id is null then 'unmatched' else 'matched' end,
        match_confidence = case when v_action = 'ignore' then null when v_ingredient_id is null then null else 1 end,
        confirmed_name = v_name,
        confirmed_quantity = v_quantity,
        confirmed_unit = v_unit,
        storage = v_storage,
        action = v_action,
        updated_at = now()
    where id = v_item_id and receipt_import_id = v_import.id;
    v_count := v_count + 1;
  end loop;

  if v_count <> (select count(*) from public.receipt_items where receipt_import_id = v_import.id) then
    raise exception 'RECEIPT_ITEMS_INCOMPLETE' using errcode = '22023';
  end if;
  return public.get_receipt_import(v_import.id);
end;
$$;

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
  v_invalid_item_id uuid;
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
    raise exception 'RECEIPT_ITEMS_INVALID' using errcode = '22023';
  end if;
  select * into v_import from public.receipt_imports
  where id = p_receipt_import_id and user_id = v_user_id for update;
  if not found then
    raise exception 'INVALID_REFERENCE' using errcode = 'P0001';
  end if;

  -- Bring legacy drafts onto the new backend-owned fallback before hashing.
  update public.receipt_items
  set confirmed_quantity = case
        when nullif(btrim(confirmed_unit), '') is null then 1
        when confirmed_quantity is null or confirmed_quantity <= 0 then 1
        else confirmed_quantity
      end,
      confirmed_unit = coalesce(nullif(btrim(confirmed_unit), ''), '件'),
      updated_at = now()
  where receipt_import_id = v_import.id and action = 'add_to_inventory'
    and (confirmed_quantity is null or confirmed_quantity <= 0 or nullif(btrim(confirmed_unit), '') is null);

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
    raise exception 'RECEIPT_ITEMS_INCOMPLETE' using errcode = '22023';
  end if;

  select id into v_invalid_item_id from public.receipt_items
  where receipt_import_id = v_import.id and action = 'add_to_inventory'
    and nullif(btrim(confirmed_name), '') is null
  order by position limit 1;
  if found then
    raise exception 'RECEIPT_ITEM_NAME_REQUIRED' using errcode = '22023',
      detail = jsonb_build_object('receiptItemId', v_invalid_item_id, 'field', 'confirmedName')::text;
  end if;
  select id into v_invalid_item_id from public.receipt_items
  where receipt_import_id = v_import.id and action = 'add_to_inventory'
    and (confirmed_quantity is null or confirmed_quantity <= 0)
  order by position limit 1;
  if found then
    raise exception 'RECEIPT_ITEM_QUANTITY_INVALID' using errcode = '22023',
      detail = jsonb_build_object('receiptItemId', v_invalid_item_id, 'field', 'confirmedQuantity')::text;
  end if;
  select id into v_invalid_item_id from public.receipt_items
  where receipt_import_id = v_import.id and action = 'add_to_inventory'
    and nullif(btrim(confirmed_unit), '') is null
  order by position limit 1;
  if found then
    raise exception 'RECEIPT_ITEM_UNIT_INVALID' using errcode = '22023',
      detail = jsonb_build_object('receiptItemId', v_invalid_item_id, 'field', 'confirmedUnit')::text;
  end if;
  select id into v_invalid_item_id from public.receipt_items
  where receipt_import_id = v_import.id and action = 'add_to_inventory'
    and (storage is null or storage not in ('常温', '冷藏', '冷冻'))
  order by position limit 1;
  if found then
    raise exception 'RECEIPT_ITEM_STORAGE_INVALID' using errcode = '22023',
      detail = jsonb_build_object('receiptItemId', v_invalid_item_id, 'field', 'storage')::text;
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
      when v_item.confirmed_unit in ('个', '只', '片', '根', '件') then 'count'
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

revoke all on function public.search_receipt_ingredients(text) from public, anon;
revoke all on function public.apply_receipt_recognition(uuid, text, jsonb, text) from public, anon, authenticated;
revoke all on function public.update_receipt_items(uuid, jsonb) from public, anon;
revoke all on function public.confirm_receipt_import(uuid, uuid) from public, anon;

grant execute on function public.search_receipt_ingredients(text) to authenticated;
grant execute on function public.apply_receipt_recognition(uuid, text, jsonb, text) to service_role;
grant execute on function public.update_receipt_items(uuid, jsonb) to authenticated;
grant execute on function public.confirm_receipt_import(uuid, uuid) to authenticated;
