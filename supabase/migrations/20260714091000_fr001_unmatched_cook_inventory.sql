-- FR-001 permits unmatched receipt stock in cooking while keeping it outside
-- nutrition and the meal component selector.

create table public.cook_unmatched_items (
  id uuid primary key default gen_random_uuid(),
  cook_session_id uuid not null references public.cook_sessions(id) on delete cascade,
  inventory_id uuid not null references public.inventory(id) on delete restrict,
  display_name text not null check (btrim(display_name) <> ''),
  quantity_used numeric not null check (quantity_used > 0),
  unit text not null check (btrim(unit) <> ''),
  note text,
  created_at timestamptz not null default now(),
  unique (cook_session_id, inventory_id)
);

create index cook_unmatched_items_cook_session_idx on public.cook_unmatched_items (cook_session_id);

alter table public.cook_unmatched_items enable row level security;

create policy cook_unmatched_items_select on public.cook_unmatched_items
for select to authenticated using (
  exists (
    select 1 from public.cook_sessions cs
    where cs.id = cook_session_id and cs.user_id = (select auth.uid())
  )
);

revoke all on public.cook_unmatched_items from anon, authenticated;
grant select on public.cook_unmatched_items to authenticated;

create or replace function public.search_cook_inventory(p_query text default '')
returns table (
  inventory_id uuid,
  ingredient_id uuid,
  name text,
  quantity numeric,
  unit text,
  unit_kind text,
  grams_per_unit numeric,
  storage text,
  expires_on date,
  has_trusted_grams boolean
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_query text := nullif(btrim(p_query), '');
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;

  return query
  select inv.id, inv.ingredient_id, coalesce(inv.display_name, i.name, inv.receipt_raw_name, '未命名库存'),
    inv.quantity, inv.unit, inv.unit_kind, inv.grams_per_unit, inv.storage, inv.expires_on,
    (inv.unit = 'g' or inv.grams_per_unit is not null)
  from public.inventory inv
  left join public.ingredients i on i.id = inv.ingredient_id
  where inv.user_id = v_user_id
    and inv.status = 'active'
    and inv.quantity > 0
    and (v_query is null or coalesce(inv.display_name, i.name, inv.receipt_raw_name, '') ilike '%' || v_query || '%')
  order by inv.expires_on nulls last, coalesce(inv.display_name, i.name, inv.receipt_raw_name), inv.created_at;
end;
$$;

drop function public.save_cook_session(uuid, text, date, numeric, text, jsonb, uuid);

create function public.save_cook_session(
  p_recipe_id uuid,
  p_name text,
  p_cooked_on date,
  p_total_servings numeric,
  p_note text,
  p_items jsonb,
  p_idempotency_key uuid,
  p_unmatched_items jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_hash text;
  v_existing_hash text;
  v_existing_response jsonb;
  v_recipe public.recipes%rowtype;
  v_cook_id uuid;
  v_item jsonb;
  v_inventory_id uuid;
  v_ingredient_id uuid;
  v_quantity_used numeric;
  v_unit text;
  v_note text;
  v_inventory public.inventory%rowtype;
  v_inventory_ids uuid[] := '{}'::uuid[];
  v_consumed_ingredient_ids uuid[] := '{}'::uuid[];
  v_response jsonb;
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;
  if p_recipe_id is null or p_total_servings is null or p_total_servings <= 0
     or p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0
     or p_unmatched_items is null or jsonb_typeof(p_unmatched_items) <> 'array'
     or p_idempotency_key is null then
    raise exception 'QUANTITY_INVALID' using errcode = '22023';
  end if;
  v_hash := md5(jsonb_build_object(
    'recipeId', p_recipe_id, 'name', p_name, 'cookedOn', coalesce(p_cooked_on, current_date),
    'totalServings', p_total_servings, 'note', p_note, 'items', p_items, 'unmatchedItems', p_unmatched_items
  )::text);
  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text || ':save_cook_session:' || p_idempotency_key::text, 0));
  select request_hash, response into v_existing_hash, v_existing_response
  from public.operation_requests
  where user_id = v_user_id and operation_type = 'save_cook_session' and idempotency_key = p_idempotency_key;
  if found then
    if v_existing_hash <> v_hash then
      raise exception 'IDEMPOTENCY_CONFLICT' using errcode = 'P0001';
    end if;
    return v_existing_response;
  end if;
  insert into public.operation_requests (user_id, operation_type, idempotency_key, request_hash)
  values (v_user_id, 'save_cook_session', p_idempotency_key, v_hash);

  select * into v_recipe from public.recipes where id = p_recipe_id and user_id = v_user_id;
  if not found then
    raise exception 'INVALID_REFERENCE' using errcode = 'P0001';
  end if;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    begin
      v_inventory_id := (v_item ->> 'inventoryId')::uuid;
      v_ingredient_id := (v_item ->> 'ingredientId')::uuid;
      v_quantity_used := (v_item ->> 'quantityUsed')::numeric;
      v_unit := nullif(btrim(v_item ->> 'unit'), '');
    exception when others then
      raise exception 'QUANTITY_INVALID' using errcode = '22023';
    end;
    if v_quantity_used is null or v_quantity_used <= 0 or v_unit is null or v_inventory_id = any(v_inventory_ids) then
      raise exception 'QUANTITY_INVALID' using errcode = '22023';
    end if;
    v_inventory_ids := array_append(v_inventory_ids, v_inventory_id);
  end loop;

  for v_item in select value from jsonb_array_elements(p_unmatched_items)
  loop
    begin
      v_inventory_id := (v_item ->> 'inventoryId')::uuid;
      v_quantity_used := (v_item ->> 'quantityUsed')::numeric;
      v_unit := nullif(btrim(v_item ->> 'unit'), '');
    exception when others then
      raise exception 'QUANTITY_INVALID' using errcode = '22023';
    end;
    if v_quantity_used is null or v_quantity_used <= 0 or v_unit is null or v_inventory_id = any(v_inventory_ids) then
      raise exception 'QUANTITY_INVALID' using errcode = '22023';
    end if;
    v_inventory_ids := array_append(v_inventory_ids, v_inventory_id);
  end loop;

  -- Lock all selected stock lots in a stable order before checking balances.
  perform 1 from public.inventory
  where id = any(v_inventory_ids) and user_id = v_user_id
  order by id for update;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_inventory_id := (v_item ->> 'inventoryId')::uuid;
    v_ingredient_id := (v_item ->> 'ingredientId')::uuid;
    v_quantity_used := (v_item ->> 'quantityUsed')::numeric;
    v_unit := nullif(btrim(v_item ->> 'unit'), '');
    select * into v_inventory from public.inventory where id = v_inventory_id and user_id = v_user_id;
    if not found or v_inventory.ingredient_id is distinct from v_ingredient_id then
      raise exception 'INVALID_REFERENCE' using errcode = 'P0001';
    end if;
    if v_inventory.unit <> v_unit then
      raise exception 'UNIT_CONFLICT' using errcode = 'P0001';
    end if;
    if v_inventory.status <> 'active' or v_inventory.quantity < v_quantity_used then
      raise exception 'INSUFFICIENT_STOCK' using errcode = 'P0001';
    end if;
    if not exists (
      select 1 from public.recipe_items
      where recipe_id = v_recipe.id and ingredient_id = v_ingredient_id
    ) then
      raise exception 'INVALID_REFERENCE' using errcode = 'P0001';
    end if;
    v_consumed_ingredient_ids := array_append(v_consumed_ingredient_ids, v_ingredient_id);
  end loop;

  if exists (
    select 1 from public.recipe_items ri
    where ri.recipe_id = v_recipe.id and not (ri.ingredient_id = any(v_consumed_ingredient_ids))
  ) then
    raise exception 'INVALID_REFERENCE' using errcode = 'P0001';
  end if;

  for v_item in select value from jsonb_array_elements(p_unmatched_items)
  loop
    v_inventory_id := (v_item ->> 'inventoryId')::uuid;
    v_quantity_used := (v_item ->> 'quantityUsed')::numeric;
    v_unit := nullif(btrim(v_item ->> 'unit'), '');
    select * into v_inventory from public.inventory where id = v_inventory_id and user_id = v_user_id;
    if not found or v_inventory.ingredient_id is not null then
      raise exception 'INVALID_REFERENCE' using errcode = 'P0001';
    end if;
    if v_inventory.unit <> v_unit then
      raise exception 'UNIT_CONFLICT' using errcode = 'P0001';
    end if;
    if v_inventory.status <> 'active' or v_inventory.quantity < v_quantity_used then
      raise exception 'INSUFFICIENT_STOCK' using errcode = 'P0001';
    end if;
  end loop;

  insert into public.cook_sessions (user_id, cooked_on, recipe_id, name, total_servings, note)
  values (
    v_user_id, coalesce(p_cooked_on, current_date), v_recipe.id,
    nullif(btrim(coalesce(p_name, v_recipe.name)), ''), p_total_servings, nullif(btrim(p_note), '')
  ) returning id into v_cook_id;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_inventory_id := (v_item ->> 'inventoryId')::uuid;
    v_quantity_used := (v_item ->> 'quantityUsed')::numeric;
    v_unit := nullif(btrim(v_item ->> 'unit'), '');
    v_note := nullif(btrim(v_item ->> 'note'), '');
    update public.inventory set quantity = quantity - v_quantity_used,
      status = case when quantity - v_quantity_used = 0 then 'depleted' else 'active' end,
      updated_at = now()
    where id = v_inventory_id and user_id = v_user_id;
    insert into public.inventory_movements (user_id, inventory_id, movement_type, quantity_delta, unit, cook_session_id, note)
    values (v_user_id, v_inventory_id, 'cook_consumption', -v_quantity_used, v_unit, v_cook_id, v_note);
  end loop;

  for v_item in select value from jsonb_array_elements(p_unmatched_items)
  loop
    v_inventory_id := (v_item ->> 'inventoryId')::uuid;
    v_quantity_used := (v_item ->> 'quantityUsed')::numeric;
    v_unit := nullif(btrim(v_item ->> 'unit'), '');
    v_note := nullif(btrim(v_item ->> 'note'), '');
    select * into v_inventory from public.inventory where id = v_inventory_id and user_id = v_user_id;
    update public.inventory set quantity = quantity - v_quantity_used,
      status = case when quantity - v_quantity_used = 0 then 'depleted' else 'active' end,
      updated_at = now()
    where id = v_inventory_id and user_id = v_user_id;
    insert into public.inventory_movements (user_id, inventory_id, movement_type, quantity_delta, unit, cook_session_id, note)
    values (v_user_id, v_inventory_id, 'cook_consumption', -v_quantity_used, v_unit, v_cook_id, v_note);
    insert into public.cook_unmatched_items (cook_session_id, inventory_id, display_name, quantity_used, unit, note)
    values (v_cook_id, v_inventory_id, coalesce(v_inventory.display_name, v_inventory.receipt_raw_name, '未命名库存'), v_quantity_used, v_unit, v_note);
  end loop;

  -- Unmatched stock deliberately creates no cook_items row, so no unverified
  -- nutrition reaches meals through the existing cook-session selector.
  insert into public.cook_items (cook_session_id, ingredient_id, grams)
  select v_cook_id, planned.ingredient_id,
    case when consumed.all_known_grams then consumed.known_grams else planned.recipe_grams end
  from (
    select ingredient_id, sum(grams) as recipe_grams
    from public.recipe_items where recipe_id = v_recipe.id group by ingredient_id
  ) planned
  join lateral (
    select bool_and(inv.unit = 'g' or inv.grams_per_unit is not null) as all_known_grams,
      sum(case when inv.unit = 'g' then (entry.value ->> 'quantityUsed')::numeric
               when inv.grams_per_unit is not null then (entry.value ->> 'quantityUsed')::numeric * inv.grams_per_unit
               else 0 end) as known_grams
    from jsonb_array_elements(p_items) entry(value)
    join public.inventory inv on inv.id = (entry.value ->> 'inventoryId')::uuid
    where inv.ingredient_id = planned.ingredient_id and inv.user_id = v_user_id
  ) consumed on true;

  select jsonb_build_object(
    'cookSessionId', cs.id, 'name', coalesce(cs.name, v_recipe.name), 'cookedOn', cs.cooked_on,
    'totalServings', cs.total_servings,
    'nutrition', jsonb_build_object(
      'kcal', coalesce(cn.total_kcal, 0), 'protein', coalesce(cn.total_protein, 0),
      'carb', coalesce(cn.total_carb, 0), 'fat', coalesce(cn.total_fat, 0),
      'estimated', not coalesce(cn.all_verified, false)
    )
  ) into v_response
  from public.cook_sessions cs
  left join public.cook_nutrition cn on cn.cook_session_id = cs.id
  where cs.id = v_cook_id;

  update public.operation_requests set response = v_response, updated_at = now()
  where user_id = v_user_id and operation_type = 'save_cook_session' and idempotency_key = p_idempotency_key;
  return v_response;
end;
$$;

revoke all on function public.search_cook_inventory(text) from public, anon;
revoke all on function public.save_cook_session(uuid, text, date, numeric, text, jsonb, uuid, jsonb) from public, anon;
grant execute on function public.search_cook_inventory(text) to authenticated;
grant execute on function public.save_cook_session(uuid, text, date, numeric, text, jsonb, uuid, jsonb) to authenticated;
