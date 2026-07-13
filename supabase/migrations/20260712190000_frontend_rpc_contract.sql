-- Stable RPC contract for the phase-one React client.
-- All functions use SECURITY INVOKER and are executable only by authenticated.

alter table public.meals
  add constraint meals_meal_type_check
  check (meal_type in ('早餐', '早午餐', '午餐', '晚餐', '加餐'));

alter table public.meal_items
  add column position integer not null default 0,
  add constraint meal_items_position_check check (position >= 0),
  add constraint meal_items_servings_positive check (servings_eaten > 0);

alter table public.targets
  add constraint targets_user_id_key unique (user_id);

insert into public.targets (user_id)
select id from auth.users
on conflict (user_id) do nothing;

-- Strengthen direct-write policies so a meal item cannot reference a source
-- owned by another user, even if the client bypasses the RPC contract.
drop policy if exists meal_items_insert on public.meal_items;
drop policy if exists meal_items_update on public.meal_items;

create policy meal_items_insert on public.meal_items
for insert
to authenticated
with check (
  exists (
    select 1
    from public.meals m
    where m.id = meal_id
      and m.user_id = (select auth.uid())
  )
  and (
    (
      cook_session_id is not null
      and ingredient_id is null
      and exists (
        select 1
        from public.cook_sessions cs
        where cs.id = cook_session_id
          and cs.user_id = (select auth.uid())
      )
    )
    or
    (
      ingredient_id is not null
      and cook_session_id is null
      and exists (
        select 1
        from public.ingredients i
        where i.id = ingredient_id
          and i.user_id = (select auth.uid())
      )
    )
  )
);

create policy meal_items_update on public.meal_items
for update
to authenticated
using (
  exists (
    select 1
    from public.meals m
    where m.id = meal_id
      and m.user_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1
    from public.meals m
    where m.id = meal_id
      and m.user_id = (select auth.uid())
  )
  and (
    (
      cook_session_id is not null
      and ingredient_id is null
      and exists (
        select 1
        from public.cook_sessions cs
        where cs.id = cook_session_id
          and cs.user_id = (select auth.uid())
      )
    )
    or
    (
      ingredient_id is not null
      and cook_session_id is null
      and exists (
        select 1
        from public.ingredients i
        where i.id = ingredient_id
          and i.user_id = (select auth.uid())
      )
    )
  )
);

create or replace function public.get_today(p_date date)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_result jsonb;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  if p_date is null then
    raise exception 'Date is required' using errcode = '22004';
  end if;

  select jsonb_build_object(
    'date', p_date,
    'total', jsonb_build_object(
      'kcal', coalesce(ds.total_kcal, 0),
      'protein', coalesce(ds.total_protein, 0),
      'carb', coalesce(ds.total_carb, 0),
      'fat', coalesce(ds.total_fat, 0)
    ),
    'target', jsonb_build_object(
      'kcal', t.daily_kcal,
      'protein', t.daily_protein_g
    ),
    'meals', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', m.id,
          'mealType', m.meal_type,
          'note', m.note,
          'nutrition', jsonb_build_object(
            'kcal', coalesce(mn.kcal, 0),
            'protein', coalesce(mn.protein, 0),
            'carb', coalesce(mn.carb, 0),
            'fat', coalesce(mn.fat, 0)
          ),
          'items', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'id', mi.id,
                'sourceType', case
                  when mi.cook_session_id is not null then 'cook_session'
                  else 'ingredient'
                end,
                'sourceId', coalesce(mi.cook_session_id, mi.ingredient_id),
                'name', coalesce(cs.name, r.name, i.name, '未命名'),
                'servings', mi.servings_eaten,
                'nutrition', jsonb_build_object(
                  'kcal', case
                    when mi.cook_session_id is not null
                      then mi.servings_eaten * coalesce(cn.per_serving_kcal, 0)
                    else mi.servings_eaten * coalesce(i.serving_grams / 100.0 * i.kcal_per_100g, 0)
                  end,
                  'protein', case
                    when mi.cook_session_id is not null
                      then mi.servings_eaten * coalesce(cn.per_serving_protein, 0)
                    else mi.servings_eaten * coalesce(i.serving_grams / 100.0 * i.protein_per_100g, 0)
                  end,
                  'carb', case
                    when mi.cook_session_id is not null
                      then mi.servings_eaten * coalesce(cn.per_serving_carb, 0)
                    else mi.servings_eaten * coalesce(i.serving_grams / 100.0 * i.carb_per_100g, 0)
                  end,
                  'fat', case
                    when mi.cook_session_id is not null
                      then mi.servings_eaten * coalesce(cn.per_serving_fat, 0)
                    else mi.servings_eaten * coalesce(i.serving_grams / 100.0 * i.fat_per_100g, 0)
                  end
                ),
                'estimated', case
                  when mi.cook_session_id is not null then not coalesce(cn.all_verified, false)
                  else not coalesce(i.is_verified, false)
                end
              )
              order by mi.position, mi.id
            )
            from public.meal_items mi
            left join public.cook_sessions cs on cs.id = mi.cook_session_id
            left join public.recipes r on r.id = cs.recipe_id
            left join public.cook_nutrition cn on cn.cook_session_id = mi.cook_session_id
            left join public.ingredients i on i.id = mi.ingredient_id
            where mi.meal_id = m.id
          ), '[]'::jsonb)
        )
        order by
          case m.meal_type
            when '早餐' then 1
            when '早午餐' then 2
            when '午餐' then 3
            when '晚餐' then 4
            when '加餐' then 5
            else 6
          end,
          m.id
      )
      from public.meals m
      left join public.meal_nutrition mn on mn.meal_id = m.id
      where m.user_id = v_user_id
        and m.eaten_on = p_date
    ), '[]'::jsonb)
  )
  into v_result
  from (select 1) seed
  left join public.daily_summary ds on ds.eaten_on = p_date
  left join lateral (
    select daily_kcal, daily_protein_g
    from public.targets
    where user_id = v_user_id
    limit 1
  ) t on true;

  return v_result;
end;
$$;

create or replace function public.search_meal_components(
  p_source_type text,
  p_query text
)
returns table (
  source_type text,
  source_id uuid,
  name text,
  subtitle text,
  serving_grams numeric,
  available_servings numeric,
  per_serving_kcal numeric,
  per_serving_protein numeric,
  per_serving_carb numeric,
  per_serving_fat numeric,
  estimated boolean,
  last_used_on date
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
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  if p_source_type is not null
     and p_source_type not in ('cook_session', 'ingredient') then
    raise exception 'Invalid source type' using errcode = '22023';
  end if;

  return query
  select *
  from (
    select
      'cook_session'::text as source_type,
      cs.id as source_id,
      coalesce(cs.name, r.name, '未命名') as name,
      ('做好于 ' || cs.cooked_on::text)::text as subtitle,
      null::numeric as serving_grams,
      greatest(cs.total_servings - coalesce(used.servings, 0), 0) as available_servings,
      cn.per_serving_kcal,
      cn.per_serving_protein,
      cn.per_serving_carb,
      cn.per_serving_fat,
      not coalesce(cn.all_verified, false) as estimated,
      used.last_used_on
    from public.cook_sessions cs
    left join public.recipes r on r.id = cs.recipe_id
    join public.cook_nutrition cn on cn.cook_session_id = cs.id
    left join lateral (
      select
        sum(mi.servings_eaten) as servings,
        max(m.eaten_on) as last_used_on
      from public.meal_items mi
      join public.meals m on m.id = mi.meal_id
      where mi.cook_session_id = cs.id
        and m.user_id = v_user_id
    ) used on true
    where cs.user_id = v_user_id
      and (p_source_type is null or p_source_type = 'cook_session')
      and (v_query is null or coalesce(cs.name, r.name, '') ilike '%' || v_query || '%')
      and greatest(cs.total_servings - coalesce(used.servings, 0), 0) > 0

    union all

    select
      'ingredient'::text as source_type,
      i.id as source_id,
      i.name,
      coalesce(i.category, '单品') as subtitle,
      i.serving_grams,
      null::numeric as available_servings,
      i.serving_grams / 100.0 * i.kcal_per_100g as per_serving_kcal,
      i.serving_grams / 100.0 * i.protein_per_100g as per_serving_protein,
      i.serving_grams / 100.0 * i.carb_per_100g as per_serving_carb,
      i.serving_grams / 100.0 * i.fat_per_100g as per_serving_fat,
      not coalesce(i.is_verified, false) as estimated,
      used.last_used_on
    from public.ingredients i
    left join lateral (
      select max(m.eaten_on) as last_used_on
      from public.meal_items mi
      join public.meals m on m.id = mi.meal_id
      where mi.ingredient_id = i.id
        and m.user_id = v_user_id
    ) used on true
    where i.user_id = v_user_id
      and i.serving_grams is not null
      and (p_source_type is null or p_source_type = 'ingredient')
      and (v_query is null or i.name ilike '%' || v_query || '%')
  ) options
  order by options.last_used_on desc nulls last, options.name;
end;
$$;

create or replace function public.save_meal(
  p_eaten_on date,
  p_meal_type text,
  p_note text,
  p_items jsonb
)
returns uuid
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_meal_id uuid;
  v_item jsonb;
  v_ordinality bigint;
  v_source_type text;
  v_source_id uuid;
  v_servings numeric;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  if p_eaten_on is null then
    raise exception 'Date is required' using errcode = '22004';
  end if;

  if p_meal_type not in ('早餐', '早午餐', '午餐', '晚餐', '加餐') then
    raise exception 'Invalid meal type' using errcode = '22023';
  end if;

  if p_items is null
     or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) = 0 then
    raise exception 'At least one meal item is required' using errcode = '22023';
  end if;

  insert into public.meals (user_id, eaten_on, meal_type, note)
  values (v_user_id, p_eaten_on, p_meal_type, nullif(btrim(p_note), ''))
  returning id into v_meal_id;

  for v_item, v_ordinality in
    select value, ordinality
    from jsonb_array_elements(p_items) with ordinality
  loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'Every meal item must be an object' using errcode = '22023';
    end if;

    v_source_type := v_item ->> 'sourceType';

    begin
      v_servings := (v_item ->> 'servings')::numeric;
    exception when others then
      raise exception 'Invalid servings value' using errcode = '22023';
    end;

    if v_servings is null or v_servings <= 0 then
      raise exception 'Servings must be greater than zero' using errcode = '22023';
    end if;

    if v_source_type = 'cook_session' then
      begin
        v_source_id := (v_item ->> 'cookSessionId')::uuid;
      exception when others then
        raise exception 'Invalid cook session id' using errcode = '22023';
      end;

      if not exists (
        select 1 from public.cook_sessions
        where id = v_source_id and user_id = v_user_id
      ) then
        raise exception 'Cook session not found' using errcode = '22023';
      end if;

      insert into public.meal_items (
        meal_id, cook_session_id, ingredient_id, servings_eaten, position
      ) values (
        v_meal_id, v_source_id, null, v_servings, (v_ordinality - 1)::integer
      );
    elsif v_source_type = 'ingredient' then
      begin
        v_source_id := (v_item ->> 'ingredientId')::uuid;
      exception when others then
        raise exception 'Invalid ingredient id' using errcode = '22023';
      end;

      if not exists (
        select 1 from public.ingredients
        where id = v_source_id
          and user_id = v_user_id
          and serving_grams is not null
      ) then
        raise exception 'Selectable ingredient not found' using errcode = '22023';
      end if;

      insert into public.meal_items (
        meal_id, cook_session_id, ingredient_id, servings_eaten, position
      ) values (
        v_meal_id, null, v_source_id, v_servings, (v_ordinality - 1)::integer
      );
    else
      raise exception 'Invalid source type' using errcode = '22023';
    end if;
  end loop;

  return v_meal_id;
end;
$$;

create or replace function public.update_meal(
  p_meal_id uuid,
  p_eaten_on date,
  p_meal_type text,
  p_note text,
  p_items jsonb
)
returns void
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_item jsonb;
  v_ordinality bigint;
  v_source_type text;
  v_source_id uuid;
  v_servings numeric;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  if p_meal_id is null or not exists (
    select 1 from public.meals where id = p_meal_id and user_id = v_user_id
  ) then
    raise exception 'Meal not found' using errcode = '22023';
  end if;

  if p_eaten_on is null then
    raise exception 'Date is required' using errcode = '22004';
  end if;

  if p_meal_type not in ('早餐', '早午餐', '午餐', '晚餐', '加餐') then
    raise exception 'Invalid meal type' using errcode = '22023';
  end if;

  if p_items is null
     or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) = 0 then
    raise exception 'At least one meal item is required' using errcode = '22023';
  end if;

  update public.meals
  set eaten_on = p_eaten_on,
      meal_type = p_meal_type,
      note = nullif(btrim(p_note), '')
  where id = p_meal_id
    and user_id = v_user_id;

  delete from public.meal_items where meal_id = p_meal_id;

  for v_item, v_ordinality in
    select value, ordinality
    from jsonb_array_elements(p_items) with ordinality
  loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'Every meal item must be an object' using errcode = '22023';
    end if;

    v_source_type := v_item ->> 'sourceType';

    begin
      v_servings := (v_item ->> 'servings')::numeric;
    exception when others then
      raise exception 'Invalid servings value' using errcode = '22023';
    end;

    if v_servings is null or v_servings <= 0 then
      raise exception 'Servings must be greater than zero' using errcode = '22023';
    end if;

    if v_source_type = 'cook_session' then
      begin
        v_source_id := (v_item ->> 'cookSessionId')::uuid;
      exception when others then
        raise exception 'Invalid cook session id' using errcode = '22023';
      end;

      if not exists (
        select 1 from public.cook_sessions
        where id = v_source_id and user_id = v_user_id
      ) then
        raise exception 'Cook session not found' using errcode = '22023';
      end if;

      insert into public.meal_items (
        meal_id, cook_session_id, ingredient_id, servings_eaten, position
      ) values (
        p_meal_id, v_source_id, null, v_servings, (v_ordinality - 1)::integer
      );
    elsif v_source_type = 'ingredient' then
      begin
        v_source_id := (v_item ->> 'ingredientId')::uuid;
      exception when others then
        raise exception 'Invalid ingredient id' using errcode = '22023';
      end;

      if not exists (
        select 1 from public.ingredients
        where id = v_source_id
          and user_id = v_user_id
          and serving_grams is not null
      ) then
        raise exception 'Selectable ingredient not found' using errcode = '22023';
      end if;

      insert into public.meal_items (
        meal_id, cook_session_id, ingredient_id, servings_eaten, position
      ) values (
        p_meal_id, null, v_source_id, v_servings, (v_ordinality - 1)::integer
      );
    else
      raise exception 'Invalid source type' using errcode = '22023';
    end if;
  end loop;
end;
$$;

revoke all on function public.get_today(date) from public, anon;
revoke all on function public.search_meal_components(text, text) from public, anon;
revoke all on function public.save_meal(date, text, text, jsonb) from public, anon;
revoke all on function public.update_meal(uuid, date, text, text, jsonb) from public, anon;

grant execute on function public.get_today(date) to authenticated;
grant execute on function public.search_meal_components(text, text) to authenticated;
grant execute on function public.save_meal(date, text, text, jsonb) to authenticated;
grant execute on function public.update_meal(uuid, date, text, text, jsonb) to authenticated;
