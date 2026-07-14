-- FR-002: kitchen and purchase loop. Receipt import remains in FR-001.

alter table public.inventory
  add column display_name text,
  add column unit_kind text,
  add column grams_per_unit numeric,
  add column expires_on date,
  add column created_at timestamptz not null default now(),
  add column updated_at timestamptz not null default now();

update public.inventory
set display_name = coalesce(display_name, receipt_raw_name),
    quantity = coalesce(quantity, 0),
    status = case when coalesce(quantity, 0) > 0 then 'active' else 'depleted' end,
    unit_kind = case
      when unit = 'g' then 'weight'
      when unit in ('个', '只', '片', '根') then 'count'
      when unit in ('盒', '袋', '瓶', '包') then 'container'
      when unit in ('把', '碗', '份') then 'portion'
      else 'other'
    end;

alter table public.inventory
  alter column quantity set not null,
  alter column unit set not null,
  alter column status set not null,
  add constraint inventory_quantity_nonnegative check (quantity >= 0),
  add constraint inventory_unit_not_blank check (btrim(unit) <> ''),
  add constraint inventory_status_check check (status in ('active', 'depleted')),
  add constraint inventory_unit_kind_check check (unit_kind in ('weight', 'count', 'container', 'portion', 'other')),
  add constraint inventory_grams_per_unit_positive check (grams_per_unit is null or grams_per_unit > 0);

create table public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  inventory_id uuid not null references public.inventory(id) on delete restrict,
  movement_type text not null check (movement_type in ('purchase', 'cook_consumption', 'adjustment', 'reversal')),
  quantity_delta numeric not null check (quantity_delta <> 0),
  unit text not null check (btrim(unit) <> ''),
  cook_session_id uuid references public.cook_sessions(id) on delete restrict,
  shopping_list_id uuid,
  note text,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table public.recipe_candidates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  recipe_id uuid not null references public.recipes(id) on delete cascade,
  status text not null default 'candidate' check (status in ('wanted', 'candidate', 'kept', 'skipped')),
  position integer not null default 0 check (position >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, recipe_id)
);

create table public.weekly_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  week_start date not null,
  status text not null default 'draft' check (status in ('draft', 'confirmed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, week_start)
);

create table public.weekly_plan_items (
  id uuid primary key default gen_random_uuid(),
  weekly_plan_id uuid not null references public.weekly_plans(id) on delete cascade,
  scheduled_on date not null,
  recipe_id uuid not null references public.recipes(id) on delete restrict,
  planned_servings numeric not null default 1 check (planned_servings > 0),
  position integer not null default 0 check (position >= 0),
  source text not null default 'manual' check (source in ('manual', 'candidate_draw')),
  created_at timestamptz not null default now(),
  unique (weekly_plan_id, scheduled_on, position)
);

create table public.shopping_lists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  weekly_plan_id uuid not null references public.weekly_plans(id) on delete restrict,
  status text not null default 'generated' check (status in ('generated', 'completed')),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (weekly_plan_id)
);

alter table public.inventory_movements
  add constraint inventory_movements_shopping_list_fkey
  foreign key (shopping_list_id) references public.shopping_lists(id) on delete restrict;

create table public.shopping_list_items (
  id uuid primary key default gen_random_uuid(),
  shopping_list_id uuid not null references public.shopping_lists(id) on delete cascade,
  ingredient_id uuid not null references public.ingredients(id) on delete restrict,
  required_grams numeric not null check (required_grams > 0),
  inventory_covered_grams numeric not null default 0 check (inventory_covered_grams >= 0),
  to_purchase_grams numeric not null default 0 check (to_purchase_grams >= 0),
  purchase_quantity numeric,
  purchase_unit text,
  completed_quantity numeric,
  completed_unit text,
  storage text,
  item_status text not null default 'pending' check (item_status in ('pending', 'completed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (shopping_list_id, ingredient_id),
  check ((purchase_quantity is null) = (purchase_unit is null)),
  check ((completed_quantity is null) = (completed_unit is null))
);

create table public.operation_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  operation_type text not null check (operation_type in ('complete_purchase', 'save_cook_session')),
  idempotency_key uuid not null,
  request_hash text not null,
  response jsonb,
  status text not null default 'succeeded' check (status = 'succeeded'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, operation_type, idempotency_key)
);

create index inventory_user_active_idx on public.inventory (user_id, status, ingredient_id);
create index inventory_movements_inventory_idx on public.inventory_movements (inventory_id, occurred_at desc);
create index inventory_movements_user_idx on public.inventory_movements (user_id, occurred_at desc);
create index weekly_plan_items_plan_idx on public.weekly_plan_items (weekly_plan_id, scheduled_on, position);
create index shopping_list_items_list_idx on public.shopping_list_items (shopping_list_id, item_status);

alter table public.inventory_movements enable row level security;
alter table public.recipe_candidates enable row level security;
alter table public.weekly_plans enable row level security;
alter table public.weekly_plan_items enable row level security;
alter table public.shopping_lists enable row level security;
alter table public.shopping_list_items enable row level security;
alter table public.operation_requests enable row level security;

create policy inventory_movements_select on public.inventory_movements
for select to authenticated using (user_id = (select auth.uid()));

create policy recipe_candidates_select on public.recipe_candidates
for select to authenticated using (user_id = (select auth.uid()));

create policy weekly_plans_select on public.weekly_plans
for select to authenticated using (user_id = (select auth.uid()));

create policy weekly_plan_items_select on public.weekly_plan_items
for select to authenticated using (
  exists (
    select 1 from public.weekly_plans wp
    where wp.id = weekly_plan_id and wp.user_id = (select auth.uid())
  )
);

create policy shopping_lists_select on public.shopping_lists
for select to authenticated using (user_id = (select auth.uid()));

create policy shopping_list_items_select on public.shopping_list_items
for select to authenticated using (
  exists (
    select 1 from public.shopping_lists sl
    where sl.id = shopping_list_id and sl.user_id = (select auth.uid())
  )
);

create policy operation_requests_select on public.operation_requests
for select to authenticated using (user_id = (select auth.uid()));

-- All inventory mutations must pass through the two write RPCs below.
drop policy if exists inventory_insert on public.inventory;
drop policy if exists inventory_update on public.inventory;
drop policy if exists inventory_delete on public.inventory;

revoke insert, update, delete on public.inventory from anon, authenticated;
revoke all on public.inventory_movements, public.recipe_candidates, public.weekly_plans,
  public.weekly_plan_items, public.shopping_lists, public.shopping_list_items,
  public.operation_requests from anon, authenticated;
grant select on public.inventory, public.inventory_movements, public.recipe_candidates,
  public.weekly_plans, public.weekly_plan_items, public.shopping_lists,
  public.shopping_list_items, public.operation_requests to authenticated;

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
        'availableServings', greatest(cs.total_servings - coalesce(used.servings, 0), 0)
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

create or replace function public.list_inventory(
  p_query text default '',
  p_status text default null
)
returns jsonb
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
  if p_status is not null and p_status not in ('active', 'depleted') then
    raise exception 'QUANTITY_INVALID' using errcode = '22023';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', inv.id,
      'ingredientId', inv.ingredient_id,
      'name', coalesce(inv.display_name, i.name, inv.receipt_raw_name, '未命名库存'),
      'quantity', inv.quantity,
      'unit', inv.unit,
      'unitKind', inv.unit_kind,
      'gramsPerUnit', inv.grams_per_unit,
      'storage', inv.storage,
      'purchaseDate', inv.purchase_date,
      'expiresOn', inv.expires_on,
      'status', inv.status,
      'canAutoDeduct', inv.ingredient_id is not null,
      'hasTrustedGrams', inv.unit = 'g' or inv.grams_per_unit is not null
    ) order by inv.status, inv.expires_on nulls last, inv.created_at desc, inv.id)
    from public.inventory inv
    left join public.ingredients i on i.id = inv.ingredient_id
    where inv.user_id = v_user_id
      and (p_status is null or inv.status = p_status)
      and (v_query is null or coalesce(inv.display_name, i.name, inv.receipt_raw_name, '') ilike '%' || v_query || '%')
  ), '[]'::jsonb);
end;
$$;

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
  join public.ingredients i on i.id = inv.ingredient_id
  where inv.user_id = v_user_id
    and inv.status = 'active'
    and inv.quantity > 0
    and (v_query is null or coalesce(inv.display_name, i.name, '') ilike '%' || v_query || '%')
  order by inv.expires_on nulls last, i.name, inv.created_at;
end;
$$;

create or replace function public.get_cook_preparation(
  p_recipe_id uuid,
  p_plan_item_id uuid default null
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_recipe public.recipes%rowtype;
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;
  select * into v_recipe from public.recipes where id = p_recipe_id and user_id = v_user_id;
  if not found then
    raise exception 'INVALID_REFERENCE' using errcode = 'P0001';
  end if;
  if p_plan_item_id is not null and not exists (
    select 1 from public.weekly_plan_items wpi
    join public.weekly_plans wp on wp.id = wpi.weekly_plan_id
    where wpi.id = p_plan_item_id and wpi.recipe_id = p_recipe_id and wp.user_id = v_user_id
  ) then
    raise exception 'INVALID_REFERENCE' using errcode = 'P0001';
  end if;

  return jsonb_build_object(
    'recipe', jsonb_build_object('id', v_recipe.id, 'name', v_recipe.name, 'servings', v_recipe.servings, 'note', v_recipe.note),
    'planItemId', p_plan_item_id,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'ingredientId', ri.ingredient_id,
        'name', i.name,
        'referenceGrams', ri.grams,
        'availableGrams', coalesce(stock.available_grams, 0),
        'availabilityStatus', case
          when coalesce(stock.available_grams, 0) >= ri.grams then 'ready'
          when coalesce(stock.available_grams, 0) > 0 then 'partial'
          when coalesce(stock.active_lots, 0) > 0 then 'unit_confirmation_required'
          else 'missing'
        end,
        'inventories', coalesce(stock.inventories, '[]'::jsonb)
      ) order by i.name, ri.id)
      from public.recipe_items ri
      join public.ingredients i on i.id = ri.ingredient_id
      left join lateral (
        select
          sum(case when inv.unit = 'g' then inv.quantity else 0 end) as available_grams,
          count(*) filter (where inv.status = 'active' and inv.quantity > 0) as active_lots,
          jsonb_agg(jsonb_build_object(
            'inventoryId', inv.id,
            'quantity', inv.quantity,
            'unit', inv.unit,
            'unitKind', inv.unit_kind,
            'gramsPerUnit', inv.grams_per_unit,
            'storage', inv.storage,
            'expiresOn', inv.expires_on,
            'hasTrustedGrams', inv.unit = 'g' or inv.grams_per_unit is not null
          ) order by inv.expires_on nulls last, inv.created_at)
            filter (where inv.status = 'active' and inv.quantity > 0) as inventories
        from public.inventory inv
        where inv.user_id = v_user_id and inv.ingredient_id = ri.ingredient_id
      ) stock on true
      where ri.recipe_id = v_recipe.id
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.list_recipe_candidates()
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
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', rc.id,
      'recipeId', r.id,
      'name', r.name,
      'servings', r.servings,
      'status', rc.status,
      'position', rc.position,
      'allVerified', rn.all_verified
    ) order by rc.position, r.name)
    from public.recipe_candidates rc
    join public.recipes r on r.id = rc.recipe_id
    left join public.recipe_nutrition rn on rn.recipe_id = r.id
    where rc.user_id = v_user_id
  ), '[]'::jsonb);
end;
$$;

create or replace function public.draw_recipe_candidates(p_count integer default 1)
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
  if p_count is null or p_count < 1 or p_count > 20 then
    raise exception 'QUANTITY_INVALID' using errcode = '22023';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'recipeId', sampled.id,
      'name', sampled.name,
      'servings', sampled.servings,
      'status', sampled.status
    ))
    from (
      select r.id, r.name, r.servings, rc.status
      from public.recipe_candidates rc
      join public.recipes r on r.id = rc.recipe_id
      where rc.user_id = v_user_id and rc.status in ('wanted', 'candidate', 'kept')
      order by random()
      limit p_count
    ) sampled
  ), '[]'::jsonb);
end;
$$;

create or replace function public.get_weekly_plan(p_week_start date)
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
  if p_week_start is null then
    raise exception 'QUANTITY_INVALID' using errcode = '22004';
  end if;
  v_week_start := date_trunc('week', p_week_start::timestamp)::date;
  return jsonb_build_object(
    'weekStart', v_week_start,
    'plan', coalesce((
      select jsonb_build_object(
        'id', wp.id,
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
    ), 'null'::jsonb)
  );
end;
$$;

create or replace function public.get_shopping_list(p_weekly_plan_id uuid)
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
  return coalesce((
    select jsonb_build_object(
      'id', sl.id,
      'weeklyPlanId', sl.weekly_plan_id,
      'status', sl.status,
      'createdAt', sl.created_at,
      'completedAt', sl.completed_at,
      'items', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', sli.id,
          'ingredientId', i.id,
          'name', i.name,
          'requiredGrams', sli.required_grams,
          'inventoryCoveredGrams', sli.inventory_covered_grams,
          'toPurchaseGrams', sli.to_purchase_grams,
          'purchaseQuantity', sli.purchase_quantity,
          'purchaseUnit', sli.purchase_unit,
          'completedQuantity', sli.completed_quantity,
          'completedUnit', sli.completed_unit,
          'storage', sli.storage,
          'status', sli.item_status
        ) order by i.name)
        from public.shopping_list_items sli
        join public.ingredients i on i.id = sli.ingredient_id
        where sli.shopping_list_id = sl.id
      ), '[]'::jsonb)
    )
    from public.shopping_lists sl
    where sl.weekly_plan_id = p_weekly_plan_id and sl.user_id = v_user_id
  ), 'null'::jsonb);
end;
$$;

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
  if p_operation_type not in ('complete_purchase', 'save_cook_session') or p_idempotency_key is null then
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

create or replace function public.set_recipe_candidate_status(
  p_recipe_id uuid,
  p_status text,
  p_position integer default 0
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_result public.recipe_candidates%rowtype;
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;
  if p_status not in ('wanted', 'candidate', 'kept', 'skipped') or p_position is null or p_position < 0 then
    raise exception 'QUANTITY_INVALID' using errcode = '22023';
  end if;
  if not exists (select 1 from public.recipes where id = p_recipe_id and user_id = v_user_id) then
    raise exception 'INVALID_REFERENCE' using errcode = 'P0001';
  end if;
  insert into public.recipe_candidates (user_id, recipe_id, status, position)
  values (v_user_id, p_recipe_id, p_status, p_position)
  on conflict (user_id, recipe_id) do update
  set status = excluded.status, position = excluded.position, updated_at = now()
  returning * into v_result;
  return jsonb_build_object('id', v_result.id, 'recipeId', v_result.recipe_id, 'status', v_result.status, 'position', v_result.position);
end;
$$;

create or replace function public.save_weekly_plan(
  p_week_start date,
  p_items jsonb,
  p_status text default 'draft'
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_week_start date;
  v_plan_id uuid;
  v_item jsonb;
  v_recipe_id uuid;
  v_scheduled_on date;
  v_servings numeric;
  v_position integer;
  v_source text;
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;
  if p_week_start is null or p_items is null or jsonb_typeof(p_items) <> 'array' or p_status not in ('draft', 'confirmed') then
    raise exception 'QUANTITY_INVALID' using errcode = '22023';
  end if;
  v_week_start := date_trunc('week', p_week_start::timestamp)::date;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    begin
      v_recipe_id := (v_item ->> 'recipeId')::uuid;
      v_scheduled_on := (v_item ->> 'scheduledOn')::date;
      v_servings := (v_item ->> 'plannedServings')::numeric;
      v_position := coalesce((v_item ->> 'position')::integer, 0);
      v_source := coalesce(v_item ->> 'source', 'manual');
    exception when others then
      raise exception 'QUANTITY_INVALID' using errcode = '22023';
    end;
    if v_servings <= 0 or v_position < 0 or v_source not in ('manual', 'candidate_draw')
       or v_scheduled_on < v_week_start or v_scheduled_on > v_week_start + 6
       or not exists (select 1 from public.recipes where id = v_recipe_id and user_id = v_user_id) then
      raise exception 'INVALID_REFERENCE' using errcode = 'P0001';
    end if;
  end loop;

  select id into v_plan_id from public.weekly_plans
  where user_id = v_user_id and week_start = v_week_start for update;

  if v_plan_id is not null and exists (
    select 1 from public.shopping_lists where weekly_plan_id = v_plan_id and status = 'completed'
  ) then
    raise exception 'CONFLICT' using errcode = 'P0001';
  end if;

  if v_plan_id is null then
    insert into public.weekly_plans (user_id, week_start, status)
    values (v_user_id, v_week_start, p_status) returning id into v_plan_id;
  else
    update public.weekly_plans set status = p_status, updated_at = now() where id = v_plan_id;
    delete from public.weekly_plan_items where weekly_plan_id = v_plan_id;
  end if;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    insert into public.weekly_plan_items (weekly_plan_id, scheduled_on, recipe_id, planned_servings, position, source)
    values (
      v_plan_id,
      (v_item ->> 'scheduledOn')::date,
      (v_item ->> 'recipeId')::uuid,
      (v_item ->> 'plannedServings')::numeric,
      coalesce((v_item ->> 'position')::integer, 0),
      coalesce(v_item ->> 'source', 'manual')
    );
  end loop;

  return public.get_weekly_plan(v_week_start);
end;
$$;

create or replace function public.generate_shopping_list(p_weekly_plan_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_list_id uuid;
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;
  if not exists (
    select 1 from public.weekly_plans where id = p_weekly_plan_id and user_id = v_user_id
  ) then
    raise exception 'INVALID_REFERENCE' using errcode = 'P0001';
  end if;
  perform 1 from public.weekly_plans where id = p_weekly_plan_id for update;

  select id into v_list_id from public.shopping_lists where weekly_plan_id = p_weekly_plan_id for update;
  if v_list_id is not null and exists (select 1 from public.shopping_lists where id = v_list_id and status = 'completed') then
    raise exception 'CONFLICT' using errcode = 'P0001';
  end if;
  if v_list_id is null then
    insert into public.shopping_lists (user_id, weekly_plan_id)
    values (v_user_id, p_weekly_plan_id) returning id into v_list_id;
  else
    delete from public.shopping_list_items where shopping_list_id = v_list_id;
    update public.shopping_lists set status = 'generated', updated_at = now(), completed_at = null where id = v_list_id;
  end if;

  insert into public.shopping_list_items (
    shopping_list_id, ingredient_id, required_grams, inventory_covered_grams, to_purchase_grams
  )
  select
    v_list_id,
    needed.ingredient_id,
    needed.required_grams,
    least(needed.required_grams, coalesce(stock.available_grams, 0)),
    greatest(needed.required_grams - coalesce(stock.available_grams, 0), 0)
  from (
    select ri.ingredient_id,
      sum(ri.grams * wpi.planned_servings / nullif(r.servings, 0)) as required_grams
    from public.weekly_plan_items wpi
    join public.recipes r on r.id = wpi.recipe_id
    join public.recipe_items ri on ri.recipe_id = r.id
    where wpi.weekly_plan_id = p_weekly_plan_id
    group by ri.ingredient_id
  ) needed
  left join lateral (
    select sum(inv.quantity) as available_grams
    from public.inventory inv
    where inv.user_id = v_user_id
      and inv.ingredient_id = needed.ingredient_id
      and inv.status = 'active'
      and inv.unit = 'g'
  ) stock on true;

  if not exists (select 1 from public.shopping_list_items where shopping_list_id = v_list_id) then
    raise exception 'CONFLICT' using errcode = 'P0001';
  end if;

  return public.get_shopping_list(p_weekly_plan_id);
end;
$$;

create or replace function public.complete_purchase(
  p_shopping_list_id uuid,
  p_items jsonb,
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
  v_hash text;
  v_existing_hash text;
  v_existing_response jsonb;
  v_item jsonb;
  v_list public.shopping_lists%rowtype;
  v_line public.shopping_list_items%rowtype;
  v_line_id uuid;
  v_quantity numeric;
  v_unit text;
  v_storage text;
  v_purchase_date date;
  v_expires_on date;
  v_grams_per_unit numeric;
  v_note text;
  v_inventory_id uuid;
  v_inventory_ids uuid[] := '{}'::uuid[];
  v_unit_kind text;
  v_response jsonb;
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;
  if p_shopping_list_id is null or p_idempotency_key is null
     or p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'QUANTITY_INVALID' using errcode = '22023';
  end if;

  v_hash := md5(jsonb_build_object('shoppingListId', p_shopping_list_id, 'items', p_items)::text);
  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text || ':complete_purchase:' || p_idempotency_key::text, 0));
  select request_hash, response into v_existing_hash, v_existing_response
  from public.operation_requests
  where user_id = v_user_id and operation_type = 'complete_purchase' and idempotency_key = p_idempotency_key;
  if found then
    if v_existing_hash <> v_hash then
      raise exception 'IDEMPOTENCY_CONFLICT' using errcode = 'P0001';
    end if;
    return v_existing_response;
  end if;
  insert into public.operation_requests (user_id, operation_type, idempotency_key, request_hash)
  values (v_user_id, 'complete_purchase', p_idempotency_key, v_hash);

  select * into v_list from public.shopping_lists
  where id = p_shopping_list_id and user_id = v_user_id for update;
  if not found then
    raise exception 'INVALID_REFERENCE' using errcode = 'P0001';
  end if;
  if v_list.status = 'completed' then
    raise exception 'CONFLICT' using errcode = 'P0001';
  end if;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    begin
      v_line_id := (v_item ->> 'shoppingListItemId')::uuid;
      v_quantity := (v_item ->> 'quantity')::numeric;
      v_unit := nullif(btrim(v_item ->> 'unit'), '');
      v_purchase_date := coalesce((v_item ->> 'purchaseDate')::date, current_date);
      v_expires_on := nullif(v_item ->> 'expiresOn', '')::date;
      v_grams_per_unit := nullif(v_item ->> 'gramsPerUnit', '')::numeric;
    exception when others then
      raise exception 'QUANTITY_INVALID' using errcode = '22023';
    end;
    v_storage := nullif(btrim(v_item ->> 'storage'), '');
    v_note := nullif(btrim(v_item ->> 'note'), '');
    if v_quantity is null or v_quantity <= 0 or v_unit is null or (v_grams_per_unit is not null and v_grams_per_unit <= 0) then
      raise exception 'QUANTITY_INVALID' using errcode = '22023';
    end if;
    if v_line_id = any(v_inventory_ids) then
      raise exception 'CONFLICT' using errcode = 'P0001';
    end if;
    v_inventory_ids := array_append(v_inventory_ids, v_line_id);
  end loop;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_line_id := (v_item ->> 'shoppingListItemId')::uuid;
    select * into v_line from public.shopping_list_items
    where id = v_line_id and shopping_list_id = v_list.id for update;
    if not found then
      raise exception 'INVALID_REFERENCE' using errcode = 'P0001';
    end if;
    if v_line.item_status = 'completed' then
      raise exception 'CONFLICT' using errcode = 'P0001';
    end if;
    v_quantity := (v_item ->> 'quantity')::numeric;
    v_unit := nullif(btrim(v_item ->> 'unit'), '');
    v_storage := nullif(btrim(v_item ->> 'storage'), '');
    v_purchase_date := coalesce((v_item ->> 'purchaseDate')::date, current_date);
    v_expires_on := nullif(v_item ->> 'expiresOn', '')::date;
    v_grams_per_unit := nullif(v_item ->> 'gramsPerUnit', '')::numeric;
    v_note := nullif(btrim(v_item ->> 'note'), '');
    v_unit_kind := case
      when v_unit = 'g' then 'weight'
      when v_unit in ('个', '只', '片', '根') then 'count'
      when v_unit in ('盒', '袋', '瓶', '包') then 'container'
      when v_unit in ('把', '碗', '份') then 'portion'
      else 'other'
    end;
    insert into public.inventory (
      user_id, ingredient_id, display_name, quantity, unit, unit_kind, grams_per_unit,
      storage, purchase_date, expires_on, status, note
    )
    select v_user_id, i.id, i.name, v_quantity, v_unit, v_unit_kind,
      case when v_unit = 'g' then 1 else v_grams_per_unit end,
      v_storage, v_purchase_date, v_expires_on, 'active', v_note
    from public.ingredients i where i.id = v_line.ingredient_id and i.user_id = v_user_id
    returning id into v_inventory_id;
    if v_inventory_id is null then
      raise exception 'INVALID_REFERENCE' using errcode = 'P0001';
    end if;
    insert into public.inventory_movements (
      user_id, inventory_id, movement_type, quantity_delta, unit, shopping_list_id, note
    ) values (
      v_user_id, v_inventory_id, 'purchase', v_quantity, v_unit, v_list.id, v_note
    );
    update public.shopping_list_items
    set purchase_quantity = v_quantity,
        purchase_unit = v_unit,
        completed_quantity = v_quantity,
        completed_unit = v_unit,
        storage = v_storage,
        item_status = 'completed',
        updated_at = now()
    where id = v_line.id;
  end loop;

  update public.shopping_lists
  set status = case when not exists (
      select 1 from public.shopping_list_items where shopping_list_id = v_list.id and item_status <> 'completed'
    ) then 'completed' else 'generated' end,
    completed_at = case when not exists (
      select 1 from public.shopping_list_items where shopping_list_id = v_list.id and item_status <> 'completed'
    ) then now() else null end,
    updated_at = now()
  where id = v_list.id;

  v_response := public.get_shopping_list(v_list.weekly_plan_id);
  update public.operation_requests set response = v_response, updated_at = now()
  where user_id = v_user_id and operation_type = 'complete_purchase' and idempotency_key = p_idempotency_key;
  return v_response;
end;
$$;

create or replace function public.save_cook_session(
  p_recipe_id uuid,
  p_name text,
  p_cooked_on date,
  p_total_servings numeric,
  p_note text,
  p_items jsonb,
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
     or p_idempotency_key is null then
    raise exception 'QUANTITY_INVALID' using errcode = '22023';
  end if;
  v_hash := md5(jsonb_build_object(
    'recipeId', p_recipe_id, 'name', p_name, 'cookedOn', coalesce(p_cooked_on, current_date),
    'totalServings', p_total_servings, 'note', p_note, 'items', p_items
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

  -- Lock every selected stock lot in a stable order before checking balances.
  perform 1 from public.inventory
  where id = any(v_inventory_ids) and user_id = v_user_id
  order by id for update;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_inventory_id := (v_item ->> 'inventoryId')::uuid;
    v_ingredient_id := (v_item ->> 'ingredientId')::uuid;
    v_quantity_used := (v_item ->> 'quantityUsed')::numeric;
    v_unit := nullif(btrim(v_item ->> 'unit'), '');
    v_note := nullif(btrim(v_item ->> 'note'), '');
    select * into v_inventory from public.inventory
    where id = v_inventory_id and user_id = v_user_id;
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

  -- Nutrition grams are deliberately independent from inventory units. When a
  -- lot has a trusted gram source the server uses it; otherwise it keeps the
  -- recipe's already-confirmed gram amount instead of converting a manual unit.
  insert into public.cook_items (cook_session_id, ingredient_id, grams)
  select
    v_cook_id,
    planned.ingredient_id,
    case when consumed.all_known_grams then consumed.known_grams else planned.recipe_grams end
  from (
    select ingredient_id, sum(grams) as recipe_grams
    from public.recipe_items
    where recipe_id = v_recipe.id
    group by ingredient_id
  ) planned
  join lateral (
    select
      bool_and(inv.unit = 'g' or inv.grams_per_unit is not null) as all_known_grams,
      sum(case
        when inv.unit = 'g' then (entry.value ->> 'quantityUsed')::numeric
        when inv.grams_per_unit is not null then (entry.value ->> 'quantityUsed')::numeric * inv.grams_per_unit
        else 0
      end) as known_grams
    from jsonb_array_elements(p_items) entry(value)
    join public.inventory inv on inv.id = (entry.value ->> 'inventoryId')::uuid
    where inv.ingredient_id = planned.ingredient_id and inv.user_id = v_user_id
  ) consumed on true;

  select jsonb_build_object(
    'cookSessionId', cs.id,
    'name', coalesce(cs.name, v_recipe.name),
    'cookedOn', cs.cooked_on,
    'totalServings', cs.total_servings,
    'nutrition', jsonb_build_object(
      'kcal', coalesce(cn.total_kcal, 0),
      'protein', coalesce(cn.total_protein, 0),
      'carb', coalesce(cn.total_carb, 0),
      'fat', coalesce(cn.total_fat, 0),
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

revoke all on function public.get_kitchen_home(date) from public, anon;
revoke all on function public.list_inventory(text, text) from public, anon;
revoke all on function public.search_cook_inventory(text) from public, anon;
revoke all on function public.get_cook_preparation(uuid, uuid) from public, anon;
revoke all on function public.list_recipe_candidates() from public, anon;
revoke all on function public.draw_recipe_candidates(integer) from public, anon;
revoke all on function public.get_weekly_plan(date) from public, anon;
revoke all on function public.get_shopping_list(uuid) from public, anon;
revoke all on function public.get_operation_result(text, uuid) from public, anon;
revoke all on function public.set_recipe_candidate_status(uuid, text, integer) from public, anon;
revoke all on function public.save_weekly_plan(date, jsonb, text) from public, anon;
revoke all on function public.generate_shopping_list(uuid) from public, anon;
revoke all on function public.complete_purchase(uuid, jsonb, uuid) from public, anon;
revoke all on function public.save_cook_session(uuid, text, date, numeric, text, jsonb, uuid) from public, anon;

grant execute on function public.get_kitchen_home(date) to authenticated;
grant execute on function public.list_inventory(text, text) to authenticated;
grant execute on function public.search_cook_inventory(text) to authenticated;
grant execute on function public.get_cook_preparation(uuid, uuid) to authenticated;
grant execute on function public.list_recipe_candidates() to authenticated;
grant execute on function public.draw_recipe_candidates(integer) to authenticated;
grant execute on function public.get_weekly_plan(date) to authenticated;
grant execute on function public.get_shopping_list(uuid) to authenticated;
grant execute on function public.get_operation_result(text, uuid) to authenticated;
grant execute on function public.set_recipe_candidate_status(uuid, text, integer) to authenticated;
grant execute on function public.save_weekly_plan(date, jsonb, text) to authenticated;
grant execute on function public.generate_shopping_list(uuid) to authenticated;
grant execute on function public.complete_purchase(uuid, jsonb, uuid) to authenticated;
grant execute on function public.save_cook_session(uuid, text, date, numeric, text, jsonb, uuid) to authenticated;
