-- Return the documented input error code before testing referenced recipes.

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
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'QUANTITY_INVALID' using errcode = '22023';
    end if;
    begin
      v_recipe_id := (v_item ->> 'recipeId')::uuid;
      v_scheduled_on := (v_item ->> 'scheduledOn')::date;
      v_servings := (v_item ->> 'plannedServings')::numeric;
      v_position := coalesce((v_item ->> 'position')::integer, 0);
      v_source := coalesce(v_item ->> 'source', 'manual');
    exception when others then
      raise exception 'QUANTITY_INVALID' using errcode = '22023';
    end;
    if v_recipe_id is null or v_scheduled_on is null or v_servings is null or v_position is null
       or v_servings <= 0 or v_position < 0 or v_source not in ('manual', 'candidate_draw')
       or v_scheduled_on < v_week_start or v_scheduled_on > v_week_start + 6 then
      raise exception 'QUANTITY_INVALID' using errcode = '22023';
    end if;
    if not exists (select 1 from public.recipes where id = v_recipe_id and user_id = v_user_id) then
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
