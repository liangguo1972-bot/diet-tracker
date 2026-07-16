-- FR-004: cook from inventory first, then optionally confirm a recipe from
-- the saved pot. Inventory deduction and nutrition grams remain independent.

alter table public.cook_sessions
  add column source_type text not null default 'recipe',
  add column recipe_confirmation_status text not null default 'not_required',
  add column recipe_confirmed_at timestamptz;

update public.cook_sessions
set source_type = 'without_recipe',
    recipe_confirmation_status = 'pending'
where recipe_id is null;

alter table public.cook_sessions
  add constraint cook_sessions_source_type_check
    check (source_type in ('recipe', 'without_recipe')),
  add constraint cook_sessions_recipe_confirmation_status_check
    check (recipe_confirmation_status in ('not_required', 'pending', 'confirmed')),
  add constraint cook_sessions_recipe_confirmation_consistency_check
    check (
      (source_type = 'recipe' and recipe_confirmation_status = 'not_required' and recipe_id is not null)
      or
      (source_type = 'without_recipe' and (
        (recipe_confirmation_status = 'pending' and recipe_id is null and recipe_confirmed_at is null)
        or
        (recipe_confirmation_status = 'confirmed' and recipe_id is not null and recipe_confirmed_at is not null)
      ))
    );

alter table public.operation_requests drop constraint operation_requests_operation_type_check;
alter table public.operation_requests add constraint operation_requests_operation_type_check
  check (operation_type in (
    'complete_purchase',
    'save_cook_session',
    'confirm_receipt_import',
    'create_recipe',
    'save_cook_without_recipe',
    'create_recipe_from_cook_session'
  ));

create or replace function public.get_operation_result(
  p_operation_type text,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;
  if p_operation_type not in (
    'complete_purchase',
    'save_cook_session',
    'confirm_receipt_import',
    'create_recipe',
    'save_cook_without_recipe',
    'create_recipe_from_cook_session'
  ) or p_idempotency_key is null then
    raise exception 'QUANTITY_INVALID' using errcode = '22023';
  end if;
  return coalesce((
    select jsonb_build_object('status', orq.status, 'response', orq.response)
    from public.operation_requests orq
    where orq.user_id = v_user_id
      and orq.operation_type = p_operation_type
      and orq.idempotency_key = p_idempotency_key
  ), 'null'::jsonb);
end;
$$;

create or replace function public.get_cook_recipe_confirmation(p_cook_session_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;
  if not exists (
    select 1 from public.cook_sessions cs
    where cs.id = p_cook_session_id and cs.user_id = v_user_id
  ) then
    raise exception 'INVALID_REFERENCE' using errcode = 'P0001';
  end if;

  return (
    select jsonb_build_object(
      'cookSessionId', cs.id,
      'sourceType', cs.source_type,
      'recipeConfirmationStatus', cs.recipe_confirmation_status,
      'name', coalesce(cs.name, r.name, '未命名成品'),
      'cookedOn', cs.cooked_on,
      'totalServings', cs.total_servings,
      'recipeId', cs.recipe_id,
      'recipeName', r.name,
      'candidateId', rc.id,
      'recipeConfirmedAt', cs.recipe_confirmed_at,
      'items', coalesce((
        select jsonb_agg(jsonb_build_object(
          'ingredientId', ci.ingredient_id,
          'ingredientName', i.name,
          'grams', ci.grams,
          'isVerified', coalesce(i.is_verified, false)
        ) order by i.name, ci.id)
        from public.cook_items ci
        join public.ingredients i on i.id = ci.ingredient_id
        where ci.cook_session_id = cs.id
      ), '[]'::jsonb),
      'unmatchedItems', coalesce((
        select jsonb_agg(jsonb_build_object(
          'inventoryId', cui.inventory_id,
          'name', cui.display_name,
          'quantityUsed', cui.quantity_used,
          'unit', cui.unit
        ) order by cui.created_at, cui.id)
        from public.cook_unmatched_items cui
        where cui.cook_session_id = cs.id
      ), '[]'::jsonb)
    )
    from public.cook_sessions cs
    left join public.recipes r on r.id = cs.recipe_id
    left join public.recipe_candidates rc
      on rc.recipe_id = cs.recipe_id and rc.user_id = cs.user_id
    where cs.id = p_cook_session_id and cs.user_id = v_user_id
  );
end;
$$;

create or replace function public.get_kitchen_home(p_date date default current_date)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_week_start date;
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;

  v_week_start := date_trunc('week', coalesce(p_date, current_date)::timestamp)::date;

  return jsonb_build_object(
    'date', coalesce(p_date, current_date),
    'inventorySummary', jsonb_build_object(
      'activeLots', (select count(*) from public.inventory where user_id = v_user_id and status = 'active'),
      'depletedLots', (select count(*) from public.inventory where user_id = v_user_id and status = 'depleted'),
      'expiringLots', (select count(*) from public.inventory where user_id = v_user_id and status = 'active' and expires_on is not null and expires_on <= coalesce(p_date, current_date) + 2)
    ),
    'weeklyPlan', coalesce((
      select jsonb_build_object(
        'id', wp.id,
        'weekStart', wp.week_start,
        'status', wp.status,
        'items', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', wpi.id,
            'scheduledOn', wpi.scheduled_on,
            'recipeId', r.id,
            'recipeName', r.name,
            'plannedServings', wpi.planned_servings,
            'position', wpi.position,
            'source', wpi.source
          ) order by wpi.scheduled_on, wpi.position)
          from public.weekly_plan_items wpi
          join public.recipes r on r.id = wpi.recipe_id
          where wpi.weekly_plan_id = wp.id
        ), '[]'::jsonb)
      )
      from public.weekly_plans wp
      where wp.user_id = v_user_id and wp.week_start = v_week_start
    ), 'null'::jsonb),
    'readyCookSessions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', cs.id,
        'name', coalesce(cs.name, r.name, '未命名'),
        'cookedOn', cs.cooked_on,
        'availableServings', greatest(cs.total_servings - coalesce(used.servings, 0), 0),
        'recipeId', cs.recipe_id,
        'sourceType', cs.source_type,
        'recipeConfirmationStatus', cs.recipe_confirmation_status
      ) order by cs.cooked_on desc, cs.id)
      from public.cook_sessions cs
      left join public.recipes r on r.id = cs.recipe_id
      left join lateral (
        select sum(mi.servings_eaten) as servings
        from public.meal_items mi
        join public.meals m on m.id = mi.meal_id
        where mi.cook_session_id = cs.id and m.user_id = v_user_id
      ) used on true
      where cs.user_id = v_user_id
        and greatest(cs.total_servings - coalesce(used.servings, 0), 0) > 0
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.save_cook_session_without_recipe(
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
  v_name text := btrim(coalesce(p_name, ''));
  v_hash text;
  v_existing_hash text;
  v_existing_response jsonb;
  v_cook_id uuid;
  v_item jsonb;
  v_position integer;
  v_inventory_id uuid;
  v_ingredient_id uuid;
  v_quantity_used numeric;
  v_grams numeric;
  v_unit text;
  v_note text;
  v_inventory public.inventory%rowtype;
  v_inventory_ids uuid[] := '{}'::uuid[];
  v_response jsonb;
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;
  if v_name = '' or char_length(v_name) > 120 then
    raise exception 'COOK_NAME_REQUIRED' using errcode = '22023';
  end if;
  if p_total_servings is null or p_total_servings <= 0 or p_total_servings > 1000 then
    raise exception 'QUANTITY_INVALID' using errcode = '22023';
  end if;
  if p_idempotency_key is null then
    raise exception 'IDEMPOTENCY_REQUIRED' using errcode = '22023';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 100
     or p_unmatched_items is null or jsonb_typeof(p_unmatched_items) <> 'array'
     or jsonb_array_length(p_unmatched_items) > 100 then
    raise exception 'COOK_ITEMS_INVALID' using errcode = '22023';
  end if;

  v_hash := md5(jsonb_build_object(
    'name', v_name,
    'cookedOn', coalesce(p_cooked_on, current_date),
    'totalServings', p_total_servings,
    'note', p_note,
    'items', p_items,
    'unmatchedItems', p_unmatched_items
  )::text);

  perform pg_advisory_xact_lock(hashtextextended(
    v_user_id::text || ':save_cook_without_recipe:' || p_idempotency_key::text, 0
  ));
  select request_hash, response into v_existing_hash, v_existing_response
  from public.operation_requests
  where user_id = v_user_id
    and operation_type = 'save_cook_without_recipe'
    and idempotency_key = p_idempotency_key;
  if found then
    if v_existing_hash <> v_hash then
      raise exception 'IDEMPOTENCY_CONFLICT' using errcode = 'P0001';
    end if;
    return v_existing_response;
  end if;

  for v_item, v_position in
    select value, (ordinality - 1)::integer
    from jsonb_array_elements(p_items) with ordinality
  loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'COOK_ITEMS_INVALID'
        using errcode = '22023', detail = jsonb_build_object('position', v_position, 'field', 'item')::text;
    end if;
    begin
      v_inventory_id := (v_item->>'inventoryId')::uuid;
      v_ingredient_id := (v_item->>'ingredientId')::uuid;
      v_quantity_used := (v_item->>'quantityUsed')::numeric;
      v_grams := (v_item->>'grams')::numeric;
      v_unit := nullif(btrim(v_item->>'unit'), '');
    exception when others then
      raise exception 'COOK_ITEMS_INVALID'
        using errcode = '22023', detail = jsonb_build_object('position', v_position, 'field', 'item')::text;
    end;
    if v_quantity_used is null or v_quantity_used <= 0 or v_unit is null then
      raise exception 'QUANTITY_INVALID'
        using errcode = '22023', detail = jsonb_build_object('position', v_position, 'field', 'quantityUsed')::text;
    end if;
    if v_grams is null or v_grams <= 0 then
      raise exception 'GRAMS_REQUIRED'
        using errcode = '22023', detail = jsonb_build_object('position', v_position, 'field', 'grams')::text;
    end if;
    if v_inventory_id = any(v_inventory_ids) then
      raise exception 'COOK_ITEMS_INVALID'
        using errcode = '22023', detail = jsonb_build_object('position', v_position, 'field', 'inventoryId', 'reason', 'duplicate')::text;
    end if;
    v_inventory_ids := array_append(v_inventory_ids, v_inventory_id);
  end loop;

  for v_item, v_position in
    select value, (ordinality - 1)::integer
    from jsonb_array_elements(p_unmatched_items) with ordinality
  loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'COOK_ITEMS_INVALID'
        using errcode = '22023', detail = jsonb_build_object('position', v_position, 'field', 'unmatchedItem')::text;
    end if;
    begin
      v_inventory_id := (v_item->>'inventoryId')::uuid;
      v_quantity_used := (v_item->>'quantityUsed')::numeric;
      v_unit := nullif(btrim(v_item->>'unit'), '');
    exception when others then
      raise exception 'COOK_ITEMS_INVALID'
        using errcode = '22023', detail = jsonb_build_object('position', v_position, 'field', 'unmatchedItem')::text;
    end;
    if v_quantity_used is null or v_quantity_used <= 0 or v_unit is null then
      raise exception 'QUANTITY_INVALID'
        using errcode = '22023', detail = jsonb_build_object('position', v_position, 'field', 'quantityUsed')::text;
    end if;
    if v_inventory_id = any(v_inventory_ids) then
      raise exception 'COOK_ITEMS_INVALID'
        using errcode = '22023', detail = jsonb_build_object('position', v_position, 'field', 'inventoryId', 'reason', 'duplicate')::text;
    end if;
    v_inventory_ids := array_append(v_inventory_ids, v_inventory_id);
  end loop;

  perform 1 from public.inventory
  where id = any(v_inventory_ids) and user_id = v_user_id
  order by id for update;

  for v_item, v_position in
    select value, (ordinality - 1)::integer
    from jsonb_array_elements(p_items) with ordinality
  loop
    v_inventory_id := (v_item->>'inventoryId')::uuid;
    v_ingredient_id := (v_item->>'ingredientId')::uuid;
    v_quantity_used := (v_item->>'quantityUsed')::numeric;
    v_unit := nullif(btrim(v_item->>'unit'), '');
    select * into v_inventory from public.inventory
    where id = v_inventory_id and user_id = v_user_id;
    if not found or v_inventory.ingredient_id is distinct from v_ingredient_id
       or not exists (
         select 1 from public.ingredients i
         where i.id = v_ingredient_id and i.user_id = v_user_id
       ) then
      raise exception 'INVALID_REFERENCE'
        using errcode = 'P0001', detail = jsonb_build_object('position', v_position, 'field', 'inventoryId')::text;
    end if;
    if v_inventory.unit <> v_unit then
      raise exception 'UNIT_CONFLICT'
        using errcode = 'P0001', detail = jsonb_build_object('position', v_position, 'field', 'unit')::text;
    end if;
    if v_inventory.status <> 'active' or v_inventory.quantity < v_quantity_used then
      raise exception 'INSUFFICIENT_STOCK'
        using errcode = 'P0001', detail = jsonb_build_object(
          'position', v_position,
          'inventoryId', v_inventory_id,
          'availableQuantity', v_inventory.quantity,
          'unit', v_inventory.unit
        )::text;
    end if;
  end loop;

  for v_item, v_position in
    select value, (ordinality - 1)::integer
    from jsonb_array_elements(p_unmatched_items) with ordinality
  loop
    v_inventory_id := (v_item->>'inventoryId')::uuid;
    v_quantity_used := (v_item->>'quantityUsed')::numeric;
    v_unit := nullif(btrim(v_item->>'unit'), '');
    select * into v_inventory from public.inventory
    where id = v_inventory_id and user_id = v_user_id;
    if not found or v_inventory.ingredient_id is not null then
      raise exception 'INVALID_REFERENCE'
        using errcode = 'P0001', detail = jsonb_build_object('position', v_position, 'field', 'inventoryId')::text;
    end if;
    if v_inventory.unit <> v_unit then
      raise exception 'UNIT_CONFLICT'
        using errcode = 'P0001', detail = jsonb_build_object('position', v_position, 'field', 'unit')::text;
    end if;
    if v_inventory.status <> 'active' or v_inventory.quantity < v_quantity_used then
      raise exception 'INSUFFICIENT_STOCK'
        using errcode = 'P0001', detail = jsonb_build_object(
          'position', v_position,
          'inventoryId', v_inventory_id,
          'availableQuantity', v_inventory.quantity,
          'unit', v_inventory.unit
        )::text;
    end if;
  end loop;

  insert into public.operation_requests (user_id, operation_type, idempotency_key, request_hash)
  values (v_user_id, 'save_cook_without_recipe', p_idempotency_key, v_hash);

  insert into public.cook_sessions (
    user_id, cooked_on, recipe_id, name, total_servings, note,
    source_type, recipe_confirmation_status
  ) values (
    v_user_id, coalesce(p_cooked_on, current_date), null, v_name,
    p_total_servings, nullif(btrim(p_note), ''), 'without_recipe', 'pending'
  ) returning id into v_cook_id;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_inventory_id := (v_item->>'inventoryId')::uuid;
    v_quantity_used := (v_item->>'quantityUsed')::numeric;
    v_unit := nullif(btrim(v_item->>'unit'), '');
    v_note := nullif(btrim(v_item->>'note'), '');
    update public.inventory
    set quantity = quantity - v_quantity_used,
        status = case when quantity - v_quantity_used = 0 then 'depleted' else 'active' end,
        updated_at = now()
    where id = v_inventory_id and user_id = v_user_id;
    insert into public.inventory_movements (
      user_id, inventory_id, movement_type, quantity_delta, unit, cook_session_id, note
    ) values (
      v_user_id, v_inventory_id, 'cook_consumption', -v_quantity_used, v_unit, v_cook_id, v_note
    );
  end loop;

  for v_item in select value from jsonb_array_elements(p_unmatched_items)
  loop
    v_inventory_id := (v_item->>'inventoryId')::uuid;
    v_quantity_used := (v_item->>'quantityUsed')::numeric;
    v_unit := nullif(btrim(v_item->>'unit'), '');
    v_note := nullif(btrim(v_item->>'note'), '');
    select * into v_inventory from public.inventory
    where id = v_inventory_id and user_id = v_user_id;
    update public.inventory
    set quantity = quantity - v_quantity_used,
        status = case when quantity - v_quantity_used = 0 then 'depleted' else 'active' end,
        updated_at = now()
    where id = v_inventory_id and user_id = v_user_id;
    insert into public.inventory_movements (
      user_id, inventory_id, movement_type, quantity_delta, unit, cook_session_id, note
    ) values (
      v_user_id, v_inventory_id, 'cook_consumption', -v_quantity_used, v_unit, v_cook_id, v_note
    );
    insert into public.cook_unmatched_items (
      cook_session_id, inventory_id, display_name, quantity_used, unit, note
    ) values (
      v_cook_id, v_inventory_id,
      coalesce(v_inventory.display_name, v_inventory.receipt_raw_name, '未命名库存'),
      v_quantity_used, v_unit, v_note
    );
  end loop;

  insert into public.cook_items (cook_session_id, ingredient_id, grams)
  select v_cook_id, (entry.value->>'ingredientId')::uuid,
    sum((entry.value->>'grams')::numeric)
  from jsonb_array_elements(p_items) entry(value)
  group by (entry.value->>'ingredientId')::uuid;

  select jsonb_build_object(
    'cookSessionId', cs.id,
    'name', cs.name,
    'cookedOn', cs.cooked_on,
    'totalServings', cs.total_servings,
    'sourceType', cs.source_type,
    'recipeConfirmationStatus', cs.recipe_confirmation_status,
    'nutrition', jsonb_build_object(
      'kcal', coalesce(cn.total_kcal, 0),
      'protein', coalesce(cn.total_protein, 0),
      'carb', coalesce(cn.total_carb, 0),
      'fat', coalesce(cn.total_fat, 0),
      'estimated', not coalesce(cn.all_verified, false)
    )
  ) into v_response
  from public.cook_sessions cs
  join public.cook_nutrition cn on cn.cook_session_id = cs.id
  where cs.id = v_cook_id;

  update public.operation_requests
  set response = v_response, updated_at = now()
  where user_id = v_user_id
    and operation_type = 'save_cook_without_recipe'
    and idempotency_key = p_idempotency_key;
  return v_response;
end;
$$;

create or replace function public.create_recipe_from_cook_session(
  p_cook_session_id uuid,
  p_name text,
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
  v_name text := btrim(coalesce(p_name, ''));
  v_hash text;
  v_existing_hash text;
  v_existing_response jsonb;
  v_cook public.cook_sessions%rowtype;
  v_recipe_id uuid;
  v_candidate_id uuid;
  v_candidate_position integer;
  v_item_count integer;
  v_response jsonb;
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;
  if p_cook_session_id is null then
    raise exception 'INVALID_REFERENCE' using errcode = 'P0001';
  end if;
  if v_name = '' or char_length(v_name) > 120 then
    raise exception 'RECIPE_NAME_REQUIRED' using errcode = '22023';
  end if;
  if p_idempotency_key is null then
    raise exception 'IDEMPOTENCY_REQUIRED' using errcode = '22023';
  end if;

  v_hash := md5(jsonb_build_object(
    'cookSessionId', p_cook_session_id,
    'name', v_name
  )::text);
  perform pg_advisory_xact_lock(hashtextextended(
    v_user_id::text || ':create_recipe_from_cook_session:' || p_idempotency_key::text, 0
  ));
  select request_hash, response into v_existing_hash, v_existing_response
  from public.operation_requests
  where user_id = v_user_id
    and operation_type = 'create_recipe_from_cook_session'
    and idempotency_key = p_idempotency_key;
  if found then
    if v_existing_hash <> v_hash then
      raise exception 'IDEMPOTENCY_CONFLICT' using errcode = 'P0001';
    end if;
    return v_existing_response;
  end if;

  select * into v_cook
  from public.cook_sessions
  where id = p_cook_session_id and user_id = v_user_id
  for update;
  if not found then
    raise exception 'INVALID_REFERENCE' using errcode = 'P0001';
  end if;
  if v_cook.source_type <> 'without_recipe'
     or v_cook.recipe_confirmation_status <> 'pending'
     or v_cook.recipe_id is not null then
    raise exception 'CONFLICT' using errcode = 'P0001';
  end if;
  if not exists (
    select 1
    from public.cook_items ci
    join public.ingredients i on i.id = ci.ingredient_id and i.user_id = v_user_id
    where ci.cook_session_id = v_cook.id and ci.grams > 0
  ) then
    raise exception 'COOK_ITEMS_INVALID' using errcode = 'P0001';
  end if;
  if exists (
    select 1
    from public.cook_items ci
    left join public.ingredients i
      on i.id = ci.ingredient_id and i.user_id = v_user_id
    where ci.cook_session_id = v_cook.id
      and (ci.grams <= 0 or i.id is null)
  ) then
    raise exception 'INVALID_REFERENCE' using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    v_user_id::text || ':recipe_name:' || lower(v_name), 0
  ));
  if exists (
    select 1 from public.recipes r
    where r.user_id = v_user_id and lower(btrim(r.name)) = lower(v_name)
  ) then
    raise exception 'DUPLICATE_RECIPE_NAME' using errcode = '23505';
  end if;

  insert into public.operation_requests (user_id, operation_type, idempotency_key, request_hash)
  values (v_user_id, 'create_recipe_from_cook_session', p_idempotency_key, v_hash);

  insert into public.recipes (user_id, name, servings)
  values (v_user_id, v_name, v_cook.total_servings)
  returning id into v_recipe_id;

  insert into public.recipe_items (recipe_id, ingredient_id, grams, note)
  select v_recipe_id, ci.ingredient_id, sum(ci.grams), null
  from public.cook_items ci
  where ci.cook_session_id = v_cook.id
  group by ci.ingredient_id;
  get diagnostics v_item_count = row_count;

  select coalesce(max(position), -1) + 1 into v_candidate_position
  from public.recipe_candidates
  where user_id = v_user_id and status = 'candidate';

  insert into public.recipe_candidates (user_id, recipe_id, status, position)
  values (v_user_id, v_recipe_id, 'candidate', v_candidate_position)
  returning id into v_candidate_id;

  update public.cook_sessions
  set recipe_id = v_recipe_id,
      recipe_confirmation_status = 'confirmed',
      recipe_confirmed_at = now()
  where id = v_cook.id and user_id = v_user_id;

  v_response := jsonb_build_object(
    'cookSessionId', v_cook.id,
    'recipeId', v_recipe_id,
    'candidateId', v_candidate_id,
    'name', v_name,
    'servings', v_cook.total_servings,
    'itemCount', v_item_count,
    'candidateStatus', 'candidate',
    'recipeConfirmationStatus', 'confirmed'
  );

  update public.operation_requests
  set response = v_response, updated_at = now()
  where user_id = v_user_id
    and operation_type = 'create_recipe_from_cook_session'
    and idempotency_key = p_idempotency_key;
  return v_response;
end;
$$;

-- Cooking writes must remain transactional. Read access stays under RLS.
drop policy if exists cook_sessions_insert on public.cook_sessions;
drop policy if exists cook_sessions_update on public.cook_sessions;
drop policy if exists cook_sessions_delete on public.cook_sessions;
drop policy if exists cook_items_insert on public.cook_items;
drop policy if exists cook_items_update on public.cook_items;
drop policy if exists cook_items_delete on public.cook_items;

revoke insert, update, delete on public.cook_sessions, public.cook_items, public.cook_unmatched_items
  from anon, authenticated;
grant select on public.cook_sessions, public.cook_items, public.cook_unmatched_items
  to authenticated;

revoke all on function public.get_operation_result(text, uuid) from public, anon;
revoke all on function public.get_kitchen_home(date) from public, anon;
revoke all on function public.get_cook_recipe_confirmation(uuid) from public, anon;
revoke all on function public.save_cook_session_without_recipe(text, date, numeric, text, jsonb, uuid, jsonb)
  from public, anon;
revoke all on function public.create_recipe_from_cook_session(uuid, text, uuid)
  from public, anon;

grant execute on function public.get_operation_result(text, uuid) to authenticated;
grant execute on function public.get_kitchen_home(date) to authenticated;
grant execute on function public.get_cook_recipe_confirmation(uuid) to authenticated;
grant execute on function public.save_cook_session_without_recipe(text, date, numeric, text, jsonb, uuid, jsonb)
  to authenticated;
grant execute on function public.create_recipe_from_cook_session(uuid, text, uuid)
  to authenticated;
