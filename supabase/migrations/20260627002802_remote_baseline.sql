-- Baseline reconstructed from the linked Supabase project on 2026-07-12.
-- Mark this migration as applied on the existing project. Run it normally only
-- when creating a fresh database.

create table public.ingredients (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id),
  name text not null,
  category text,
  kcal_per_100g numeric,
  protein_per_100g numeric,
  carb_per_100g numeric,
  fat_per_100g numeric,
  package_spec text,
  storage text,
  shelf_stable text check (shelf_stable in ('yes', 'no', 'half')),
  is_verified boolean default false,
  note text,
  serving_grams numeric,
  unique (user_id, name)
);

create table public.recipes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id),
  name text not null,
  role text,
  servings numeric not null default 1,
  note text,
  unique (user_id, name)
);

create table public.recipe_items (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references public.recipes(id) on delete cascade,
  ingredient_id uuid not null references public.ingredients(id),
  grams numeric not null,
  note text
);

create table public.cook_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id),
  cooked_on date not null default current_date,
  recipe_id uuid references public.recipes(id),
  name text,
  total_servings numeric not null default 1,
  note text
);

create table public.cook_items (
  id uuid primary key default gen_random_uuid(),
  cook_session_id uuid not null references public.cook_sessions(id) on delete cascade,
  ingredient_id uuid not null references public.ingredients(id),
  grams numeric not null,
  note text
);

create table public.meals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id),
  eaten_on date not null default current_date,
  meal_type text,
  note text
);

create table public.meal_items (
  id uuid primary key default gen_random_uuid(),
  meal_id uuid not null references public.meals(id) on delete cascade,
  servings_eaten numeric not null default 1,
  note text,
  cook_session_id uuid references public.cook_sessions(id),
  ingredient_id uuid references public.ingredients(id),
  constraint meal_item_one_source check (
    (cook_session_id is not null)::int + (ingredient_id is not null)::int = 1
  )
);

create table public.inventory (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id),
  ingredient_id uuid references public.ingredients(id),
  quantity numeric,
  unit text,
  storage text,
  purchase_date date,
  status text,
  receipt_raw_name text,
  price numeric,
  note text
);

create table public.body_metrics (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id),
  recorded_on date,
  weight numeric,
  waist numeric,
  energy_level integer,
  note text
);

create table public.targets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id),
  daily_protein_g numeric default 110,
  daily_kcal numeric default 1900,
  note text
);

alter table public.ingredients enable row level security;
alter table public.recipes enable row level security;
alter table public.recipe_items enable row level security;
alter table public.cook_sessions enable row level security;
alter table public.cook_items enable row level security;
alter table public.meals enable row level security;
alter table public.meal_items enable row level security;
alter table public.inventory enable row level security;
alter table public.body_metrics enable row level security;
alter table public.targets enable row level security;

create policy ingredients_select on public.ingredients for select using (user_id = auth.uid());
create policy ingredients_insert on public.ingredients for insert with check (user_id = auth.uid());
create policy ingredients_update on public.ingredients for update using (user_id = auth.uid());
create policy ingredients_delete on public.ingredients for delete using (user_id = auth.uid());

create policy recipes_select on public.recipes for select using (user_id = auth.uid());
create policy recipes_insert on public.recipes for insert with check (user_id = auth.uid());
create policy recipes_update on public.recipes for update using (user_id = auth.uid());
create policy recipes_delete on public.recipes for delete using (user_id = auth.uid());

create policy recipe_items_select on public.recipe_items for select using (
  exists (select 1 from public.recipes r where r.id = recipe_id and r.user_id = auth.uid())
);
create policy recipe_items_insert on public.recipe_items for insert with check (
  exists (select 1 from public.recipes r where r.id = recipe_id and r.user_id = auth.uid())
);
create policy recipe_items_update on public.recipe_items for update using (
  exists (select 1 from public.recipes r where r.id = recipe_id and r.user_id = auth.uid())
);
create policy recipe_items_delete on public.recipe_items for delete using (
  exists (select 1 from public.recipes r where r.id = recipe_id and r.user_id = auth.uid())
);

create policy cook_sessions_select on public.cook_sessions for select using (user_id = auth.uid());
create policy cook_sessions_insert on public.cook_sessions for insert with check (user_id = auth.uid());
create policy cook_sessions_update on public.cook_sessions for update using (user_id = auth.uid());
create policy cook_sessions_delete on public.cook_sessions for delete using (user_id = auth.uid());

create policy cook_items_select on public.cook_items for select using (
  exists (select 1 from public.cook_sessions cs where cs.id = cook_session_id and cs.user_id = auth.uid())
);
create policy cook_items_insert on public.cook_items for insert with check (
  exists (select 1 from public.cook_sessions cs where cs.id = cook_session_id and cs.user_id = auth.uid())
);
create policy cook_items_update on public.cook_items for update using (
  exists (select 1 from public.cook_sessions cs where cs.id = cook_session_id and cs.user_id = auth.uid())
);
create policy cook_items_delete on public.cook_items for delete using (
  exists (select 1 from public.cook_sessions cs where cs.id = cook_session_id and cs.user_id = auth.uid())
);

create policy meals_select on public.meals for select using (user_id = auth.uid());
create policy meals_insert on public.meals for insert with check (user_id = auth.uid());
create policy meals_update on public.meals for update using (user_id = auth.uid());
create policy meals_delete on public.meals for delete using (user_id = auth.uid());

create policy meal_items_select on public.meal_items for select using (
  exists (select 1 from public.meals m where m.id = meal_id and m.user_id = auth.uid())
);
create policy meal_items_insert on public.meal_items for insert with check (
  exists (select 1 from public.meals m where m.id = meal_id and m.user_id = auth.uid())
);
create policy meal_items_update on public.meal_items for update using (
  exists (select 1 from public.meals m where m.id = meal_id and m.user_id = auth.uid())
);
create policy meal_items_delete on public.meal_items for delete using (
  exists (select 1 from public.meals m where m.id = meal_id and m.user_id = auth.uid())
);

create policy inventory_select on public.inventory for select using (user_id = auth.uid());
create policy inventory_insert on public.inventory for insert with check (user_id = auth.uid());
create policy inventory_update on public.inventory for update using (user_id = auth.uid());
create policy inventory_delete on public.inventory for delete using (user_id = auth.uid());

create policy body_metrics_select on public.body_metrics for select using (user_id = auth.uid());
create policy body_metrics_insert on public.body_metrics for insert with check (user_id = auth.uid());
create policy body_metrics_update on public.body_metrics for update using (user_id = auth.uid());
create policy body_metrics_delete on public.body_metrics for delete using (user_id = auth.uid());

create policy targets_select on public.targets for select using (user_id = auth.uid());
create policy targets_insert on public.targets for insert with check (user_id = auth.uid());
create policy targets_update on public.targets for update using (user_id = auth.uid());
create policy targets_delete on public.targets for delete using (user_id = auth.uid());

create view public.recipe_nutrition as
select
  r.id as recipe_id,
  r.name,
  r.servings,
  sum(ri.grams / 100.0 * i.kcal_per_100g) as total_kcal,
  sum(ri.grams / 100.0 * i.protein_per_100g) as total_protein,
  sum(ri.grams / 100.0 * i.carb_per_100g) as total_carb,
  sum(ri.grams / 100.0 * i.fat_per_100g) as total_fat,
  sum(ri.grams / 100.0 * i.kcal_per_100g) / nullif(r.servings, 0) as per_serving_kcal,
  sum(ri.grams / 100.0 * i.protein_per_100g) / nullif(r.servings, 0) as per_serving_protein,
  sum(ri.grams / 100.0 * i.carb_per_100g) / nullif(r.servings, 0) as per_serving_carb,
  sum(ri.grams / 100.0 * i.fat_per_100g) / nullif(r.servings, 0) as per_serving_fat,
  bool_and(i.is_verified) as all_verified
from public.recipes r
join public.recipe_items ri on ri.recipe_id = r.id
join public.ingredients i on i.id = ri.ingredient_id
group by r.id, r.name, r.servings;

create view public.cook_nutrition as
select
  cs.id as cook_session_id,
  cs.name,
  cs.cooked_on,
  cs.total_servings,
  sum(ci.grams / 100.0 * i.kcal_per_100g) as total_kcal,
  sum(ci.grams / 100.0 * i.protein_per_100g) as total_protein,
  sum(ci.grams / 100.0 * i.carb_per_100g) as total_carb,
  sum(ci.grams / 100.0 * i.fat_per_100g) as total_fat,
  sum(ci.grams / 100.0 * i.kcal_per_100g) / nullif(cs.total_servings, 0) as per_serving_kcal,
  sum(ci.grams / 100.0 * i.protein_per_100g) / nullif(cs.total_servings, 0) as per_serving_protein,
  sum(ci.grams / 100.0 * i.carb_per_100g) / nullif(cs.total_servings, 0) as per_serving_carb,
  sum(ci.grams / 100.0 * i.fat_per_100g) / nullif(cs.total_servings, 0) as per_serving_fat,
  bool_and(i.is_verified) as all_verified
from public.cook_sessions cs
join public.cook_items ci on ci.cook_session_id = cs.id
join public.ingredients i on i.id = ci.ingredient_id
group by cs.id, cs.name, cs.cooked_on, cs.total_servings;

create view public.meal_nutrition as
select
  m.id as meal_id,
  m.eaten_on,
  m.meal_type,
  sum(x.kcal) as kcal,
  sum(x.protein) as protein,
  sum(x.carb) as carb,
  sum(x.fat) as fat
from public.meals m
join (
  select
    mi.meal_id,
    mi.servings_eaten * cn.per_serving_kcal as kcal,
    mi.servings_eaten * cn.per_serving_protein as protein,
    mi.servings_eaten * cn.per_serving_carb as carb,
    mi.servings_eaten * cn.per_serving_fat as fat
  from public.meal_items mi
  join public.cook_nutrition cn on cn.cook_session_id = mi.cook_session_id
  where mi.cook_session_id is not null

  union all

  select
    mi.meal_id,
    mi.servings_eaten * (i.serving_grams / 100.0) * i.kcal_per_100g as kcal,
    mi.servings_eaten * (i.serving_grams / 100.0) * i.protein_per_100g as protein,
    mi.servings_eaten * (i.serving_grams / 100.0) * i.carb_per_100g as carb,
    mi.servings_eaten * (i.serving_grams / 100.0) * i.fat_per_100g as fat
  from public.meal_items mi
  join public.ingredients i on i.id = mi.ingredient_id
  where mi.ingredient_id is not null
) x on x.meal_id = m.id
group by m.id, m.eaten_on, m.meal_type;

create view public.daily_summary as
select
  eaten_on,
  sum(kcal) as total_kcal,
  sum(protein) as total_protein,
  sum(carb) as total_carb,
  sum(fat) as total_fat
from public.meal_nutrition
group by eaten_on;
