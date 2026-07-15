-- FR-003: AI-assisted recipe drafts, current-user ingredient matching,
-- and atomic recipe + candidate creation.

create table public.recipe_parse_policy (
  singleton boolean primary key default true check (singleton),
  max_input_chars integer not null check (max_input_chars between 1 and 100000),
  daily_limit integer not null check (daily_limit between 1 and 1000),
  monthly_limit integer not null check (monthly_limit between 1 and 10000),
  updated_at timestamptz not null default now()
);

insert into public.recipe_parse_policy (singleton, max_input_chars, daily_limit, monthly_limit)
values (true, 20000, 10, 100);

create table public.recipe_parse_calls (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  input_chars integer not null check (input_chars > 0),
  provider text not null,
  model text not null,
  status text not null default 'processing' check (status in ('processing', 'succeeded', 'failed')),
  error_code text,
  input_tokens integer check (input_tokens is null or input_tokens >= 0),
  output_tokens integer check (output_tokens is null or output_tokens >= 0),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index recipe_parse_calls_user_created_idx
  on public.recipe_parse_calls (user_id, created_at desc);

alter table public.recipe_parse_policy enable row level security;
alter table public.recipe_parse_calls enable row level security;

revoke all on public.recipe_parse_policy, public.recipe_parse_calls from public, anon, authenticated;

create or replace function public.claim_recipe_parse_call(
  p_input_chars integer,
  p_provider text,
  p_model text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_policy public.recipe_parse_policy%rowtype;
  v_daily_used integer;
  v_monthly_used integer;
  v_call_id uuid;
  v_day_start timestamptz := date_trunc('day', now() at time zone 'UTC') at time zone 'UTC';
  v_month_start timestamptz := date_trunc('month', now() at time zone 'UTC') at time zone 'UTC';
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;

  select * into v_policy from public.recipe_parse_policy where singleton = true;
  if not found then
    raise exception 'RECIPE_PARSE_NOT_CONFIGURED' using errcode = 'P0001';
  end if;

  if p_input_chars is null or p_input_chars <= 0 or p_input_chars > v_policy.max_input_chars
     or nullif(btrim(p_provider), '') is null or nullif(btrim(p_model), '') is null then
    raise exception 'RECIPE_PARSE_INPUT_INVALID'
      using errcode = '22023',
            detail = jsonb_build_object('field', 'text', 'maxChars', v_policy.max_input_chars)::text;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text || ':recipe_parse_quota', 0));

  select count(*)::integer into v_daily_used
  from public.recipe_parse_calls
  where user_id = v_user_id and created_at >= v_day_start;

  select count(*)::integer into v_monthly_used
  from public.recipe_parse_calls
  where user_id = v_user_id and created_at >= v_month_start;

  if v_daily_used >= v_policy.daily_limit or v_monthly_used >= v_policy.monthly_limit then
    raise exception 'RATE_LIMITED'
      using errcode = 'P0001',
            detail = jsonb_build_object(
              'dailyUsed', v_daily_used,
              'dailyLimit', v_policy.daily_limit,
              'monthlyUsed', v_monthly_used,
              'monthlyLimit', v_policy.monthly_limit
            )::text;
  end if;

  insert into public.recipe_parse_calls (user_id, input_chars, provider, model)
  values (v_user_id, p_input_chars, btrim(p_provider), btrim(p_model))
  returning id into v_call_id;

  return jsonb_build_object(
    'parseCallId', v_call_id,
    'dailyUsed', v_daily_used + 1,
    'dailyLimit', v_policy.daily_limit,
    'monthlyUsed', v_monthly_used + 1,
    'monthlyLimit', v_policy.monthly_limit,
    'maxChars', v_policy.max_input_chars
  );
end;
$$;

create or replace function public.complete_recipe_parse_call(
  p_parse_call_id uuid,
  p_status text,
  p_error_code text default null,
  p_input_tokens integer default null,
  p_output_tokens integer default null
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_parse_call_id is null or p_status not in ('succeeded', 'failed')
     or (p_input_tokens is not null and p_input_tokens < 0)
     or (p_output_tokens is not null and p_output_tokens < 0) then
    raise exception 'RECIPE_PARSE_RESPONSE_INVALID' using errcode = '22023';
  end if;

  update public.recipe_parse_calls
  set status = p_status,
      error_code = nullif(btrim(p_error_code), ''),
      input_tokens = p_input_tokens,
      output_tokens = p_output_tokens,
      completed_at = now()
  where id = p_parse_call_id and status = 'processing';

  if not found then
    raise exception 'INVALID_REFERENCE' using errcode = 'P0001';
  end if;
end;
$$;

create or replace function public.search_ingredients(
  p_query text default '',
  p_limit integer default 30
)
returns table (
  ingredient_id uuid,
  name text,
  category text,
  package_spec text,
  serving_grams numeric,
  is_verified boolean,
  storage_guidance text
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_query text := btrim(coalesce(p_query, ''));
  v_limit integer := least(greatest(coalesce(p_limit, 30), 1), 50);
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;

  return query
  select i.id, i.name, i.category, i.package_spec, i.serving_grams,
         coalesce(i.is_verified, false), i.storage
  from public.ingredients i
  where i.user_id = v_user_id
    and (v_query = '' or i.name ilike '%' || v_query || '%' or coalesce(i.category, '') ilike '%' || v_query || '%')
  order by
    case when lower(i.name) = lower(v_query) then 0
         when lower(i.name) like lower(v_query) || '%' then 1
         else 2 end,
    i.name
  limit v_limit;
end;
$$;

create or replace function public.match_recipe_ingredients(p_items jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_item jsonb;
  v_position integer;
  v_name text;
  v_normalized text;
  v_ingredient public.ingredients%rowtype;
  v_match_status text;
  v_matched_by text;
  v_results jsonb := '[]'::jsonb;
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 100 then
    raise exception 'RECIPE_ITEMS_INVALID' using errcode = '22023';
  end if;

  for v_item, v_position in
    select value, (ordinality - 1)::integer
    from jsonb_array_elements(p_items) with ordinality
  loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'RECIPE_ITEMS_INVALID'
        using errcode = '22023', detail = jsonb_build_object('position', v_position, 'field', 'name')::text;
    end if;

    v_name := btrim(coalesce(v_item->>'name', v_item->>'rawName', ''));
    if v_name = '' then
      raise exception 'RECIPE_ITEMS_INVALID'
        using errcode = '22023', detail = jsonb_build_object('position', v_position, 'field', 'name')::text;
    end if;
    v_normalized := public.normalize_receipt_name(v_name);
    v_ingredient := null;
    v_match_status := 'unmatched';
    v_matched_by := null;

    select i.* into v_ingredient
    from public.ingredients i
    where i.user_id = v_user_id and lower(btrim(i.name)) = lower(v_name)
    order by i.name
    limit 1;

    if found then
      v_match_status := 'matched';
      v_matched_by := 'canonical_name';
    else
      select i.* into v_ingredient
      from public.ingredient_aliases ia
      join public.ingredients i on i.id = ia.ingredient_id and i.user_id = ia.user_id
      where ia.user_id = v_user_id and ia.normalized_alias = v_normalized
      limit 1;

      if found then
        v_match_status := 'matched';
        v_matched_by := 'confirmed_alias';
      elsif char_length(v_name) >= 2 then
        select i.* into v_ingredient
        from public.ingredients i
        where i.user_id = v_user_id
          and (i.name ilike '%' || v_name || '%' or v_name ilike '%' || i.name || '%')
        order by abs(char_length(i.name) - char_length(v_name)), i.name
        limit 1;

        if found then
          v_match_status := 'possible_match';
          v_matched_by := 'name_similarity';
        end if;
      end if;
    end if;

    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'position', coalesce((v_item->>'position')::integer, v_position),
      'rawName', v_name,
      'matchStatus', v_match_status,
      'ingredientId', v_ingredient.id,
      'ingredientName', v_ingredient.name,
      'category', v_ingredient.category,
      'packageSpec', v_ingredient.package_spec,
      'servingGrams', v_ingredient.serving_grams,
      'isVerified', coalesce(v_ingredient.is_verified, false),
      'matchedBy', v_matched_by
    ));
  end loop;

  return v_results;
exception
  when invalid_text_representation then
    raise exception 'RECIPE_ITEMS_INVALID' using errcode = '22023';
end;
$$;

alter table public.operation_requests drop constraint operation_requests_operation_type_check;
alter table public.operation_requests add constraint operation_requests_operation_type_check
  check (operation_type in ('complete_purchase', 'save_cook_session', 'confirm_receipt_import', 'create_recipe'));

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
  if p_operation_type not in ('complete_purchase', 'save_cook_session', 'confirm_receipt_import', 'create_recipe')
     or p_idempotency_key is null then
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

create or replace function public.create_recipe_with_candidate(
  p_name text,
  p_servings numeric,
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
  v_name text := btrim(coalesce(p_name, ''));
  v_hash text;
  v_existing_hash text;
  v_existing_response jsonb;
  v_item jsonb;
  v_position integer;
  v_ingredient_id uuid;
  v_grams numeric;
  v_seen_ingredients uuid[] := '{}';
  v_recipe_id uuid;
  v_candidate_id uuid;
  v_candidate_position integer;
  v_item_count integer := 0;
  v_response jsonb;
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;
  if v_name = '' then
    raise exception 'RECIPE_NAME_REQUIRED' using errcode = '22023';
  end if;
  if char_length(v_name) > 120 then
    raise exception 'RECIPE_NAME_REQUIRED' using errcode = '22023';
  end if;
  if p_servings is null or p_servings <= 0 or p_servings > 1000 then
    raise exception 'RECIPE_SERVINGS_INVALID' using errcode = '22023';
  end if;
  if p_idempotency_key is null then
    raise exception 'IDEMPOTENCY_REQUIRED' using errcode = '22023';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 100 then
    raise exception 'RECIPE_ITEMS_INVALID' using errcode = '22023';
  end if;

  v_hash := md5(jsonb_build_object(
    'name', v_name,
    'servings', p_servings,
    'items', p_items
  )::text);

  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text || ':create_recipe:' || p_idempotency_key::text, 0));
  select request_hash, response into v_existing_hash, v_existing_response
  from public.operation_requests
  where user_id = v_user_id and operation_type = 'create_recipe' and idempotency_key = p_idempotency_key;

  if found then
    if v_existing_hash <> v_hash then
      raise exception 'IDEMPOTENCY_CONFLICT' using errcode = 'P0001';
    end if;
    return v_existing_response;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text || ':recipe_name:' || lower(v_name), 0));
  if exists (
    select 1 from public.recipes r
    where r.user_id = v_user_id and lower(btrim(r.name)) = lower(v_name)
  ) then
    raise exception 'DUPLICATE_RECIPE_NAME' using errcode = '23505';
  end if;

  for v_item, v_position in
    select value, (ordinality - 1)::integer
    from jsonb_array_elements(p_items) with ordinality
  loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'RECIPE_ITEMS_INVALID'
        using errcode = '22023', detail = jsonb_build_object('position', v_position, 'field', 'item')::text;
    end if;
    if nullif(v_item->>'ingredientId', '') is null then
      raise exception 'INGREDIENT_MATCH_REQUIRED'
        using errcode = '22023', detail = jsonb_build_object('position', v_position, 'field', 'ingredientId')::text;
    end if;
    begin
      v_ingredient_id := (v_item->>'ingredientId')::uuid;
    exception when invalid_text_representation then
      raise exception 'INGREDIENT_MATCH_REQUIRED'
        using errcode = '22023', detail = jsonb_build_object('position', v_position, 'field', 'ingredientId')::text;
    end;

    if jsonb_typeof(v_item->'grams') <> 'number' then
      raise exception 'GRAMS_REQUIRED'
        using errcode = '22023', detail = jsonb_build_object('position', v_position, 'field', 'grams')::text;
    end if;
    v_grams := (v_item->>'grams')::numeric;
    if v_grams <= 0 then
      raise exception 'GRAMS_REQUIRED'
        using errcode = '22023', detail = jsonb_build_object('position', v_position, 'field', 'grams')::text;
    end if;
    if v_ingredient_id = any(v_seen_ingredients) then
      raise exception 'RECIPE_ITEMS_INVALID'
        using errcode = '22023', detail = jsonb_build_object('position', v_position, 'field', 'ingredientId', 'reason', 'duplicate')::text;
    end if;
    if not exists (
      select 1 from public.ingredients i where i.id = v_ingredient_id and i.user_id = v_user_id
    ) then
      raise exception 'INVALID_REFERENCE'
        using errcode = 'P0001', detail = jsonb_build_object('position', v_position, 'field', 'ingredientId')::text;
    end if;
    v_seen_ingredients := array_append(v_seen_ingredients, v_ingredient_id);
  end loop;

  insert into public.operation_requests (user_id, operation_type, idempotency_key, request_hash)
  values (v_user_id, 'create_recipe', p_idempotency_key, v_hash);

  insert into public.recipes (user_id, name, servings)
  values (v_user_id, v_name, p_servings)
  returning id into v_recipe_id;

  for v_item, v_position in
    select value, (ordinality - 1)::integer
    from jsonb_array_elements(p_items) with ordinality
  loop
    insert into public.recipe_items (recipe_id, ingredient_id, grams, note)
    values (
      v_recipe_id,
      (v_item->>'ingredientId')::uuid,
      (v_item->>'grams')::numeric,
      nullif(btrim(v_item->>'note'), '')
    );
    v_item_count := v_item_count + 1;
  end loop;

  select coalesce(max(position), -1) + 1 into v_candidate_position
  from public.recipe_candidates where user_id = v_user_id and status = 'candidate';

  insert into public.recipe_candidates (user_id, recipe_id, status, position)
  values (v_user_id, v_recipe_id, 'candidate', v_candidate_position)
  returning id into v_candidate_id;

  v_response := jsonb_build_object(
    'recipeId', v_recipe_id,
    'candidateId', v_candidate_id,
    'name', v_name,
    'servings', p_servings,
    'itemCount', v_item_count,
    'candidateStatus', 'candidate'
  );

  update public.operation_requests
  set response = v_response, updated_at = now()
  where user_id = v_user_id and operation_type = 'create_recipe' and idempotency_key = p_idempotency_key;

  return v_response;
end;
$$;

-- Recipe creation and candidate membership are now write-through-RPC only.
drop policy if exists recipes_insert on public.recipes;
drop policy if exists recipes_update on public.recipes;
drop policy if exists recipes_delete on public.recipes;
drop policy if exists recipe_items_insert on public.recipe_items;
drop policy if exists recipe_items_update on public.recipe_items;
drop policy if exists recipe_items_delete on public.recipe_items;

revoke insert, update, delete on public.recipes, public.recipe_items, public.recipe_candidates
  from anon, authenticated;

revoke all on function public.claim_recipe_parse_call(integer, text, text) from public, anon;
revoke all on function public.complete_recipe_parse_call(uuid, text, text, integer, integer) from public, anon, authenticated;
revoke all on function public.search_ingredients(text, integer) from public, anon;
revoke all on function public.match_recipe_ingredients(jsonb) from public, anon;
revoke all on function public.create_recipe_with_candidate(text, numeric, jsonb, uuid) from public, anon;
revoke all on function public.get_operation_result(text, uuid) from public, anon;

grant execute on function public.claim_recipe_parse_call(integer, text, text) to authenticated;
grant execute on function public.complete_recipe_parse_call(uuid, text, text, integer, integer) to service_role;
grant execute on function public.search_ingredients(text, integer) to authenticated;
grant execute on function public.match_recipe_ingredients(jsonb) to authenticated;
grant execute on function public.create_recipe_with_candidate(text, numeric, jsonb, uuid) to authenticated;
grant execute on function public.get_operation_result(text, uuid) to authenticated;
