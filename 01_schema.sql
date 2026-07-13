-- ============================================================
-- Diet Tracker · Step 1：建表 + RLS
-- 在 Supabase SQL 编辑器里粘贴运行
-- 运行成功后，Table Editor 里应能看到 8 张表
-- ============================================================

-- 1. 食材库
create table ingredients (
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
  shelf_stable text check (shelf_stable in ('yes','no','half')),
  is_verified boolean default false,
  note text,
  unique (user_id, name)
);

alter table ingredients enable row level security;
create policy "ingredients_select" on ingredients for select using (user_id = auth.uid());
create policy "ingredients_insert" on ingredients for insert with check (user_id = auth.uid());
create policy "ingredients_update" on ingredients for update using (user_id = auth.uid());
create policy "ingredients_delete" on ingredients for delete using (user_id = auth.uid());

-- 2. 配方
create table recipes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id),
  name text not null,
  role text,
  servings numeric not null default 1,
  note text,
  unique (user_id, name)
);

alter table recipes enable row level security;
create policy "recipes_select" on recipes for select using (user_id = auth.uid());
create policy "recipes_insert" on recipes for insert with check (user_id = auth.uid());
create policy "recipes_update" on recipes for update using (user_id = auth.uid());
create policy "recipes_delete" on recipes for delete using (user_id = auth.uid());

-- 3. 配方明细（通过父表 recipes 校验归属）
create table recipe_items (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references recipes(id) on delete cascade,
  ingredient_id uuid not null references ingredients(id),
  grams numeric not null,
  note text
);

alter table recipe_items enable row level security;
create policy "recipe_items_select" on recipe_items for select
  using (exists (select 1 from recipes r where r.id = recipe_id and r.user_id = auth.uid()));
create policy "recipe_items_insert" on recipe_items for insert
  with check (exists (select 1 from recipes r where r.id = recipe_id and r.user_id = auth.uid()));
create policy "recipe_items_update" on recipe_items for update
  using (exists (select 1 from recipes r where r.id = recipe_id and r.user_id = auth.uid()));
create policy "recipe_items_delete" on recipe_items for delete
  using (exists (select 1 from recipes r where r.id = recipe_id and r.user_id = auth.uid()));

-- 4. 一餐
create table meals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id),
  eaten_on date not null default current_date,
  meal_type text,
  note text
);

alter table meals enable row level security;
create policy "meals_select" on meals for select using (user_id = auth.uid());
create policy "meals_insert" on meals for insert with check (user_id = auth.uid());
create policy "meals_update" on meals for update using (user_id = auth.uid());
create policy "meals_delete" on meals for delete using (user_id = auth.uid());

-- 5. 一餐吃了哪些配方各几份（通过父表 meals 校验归属）
create table meal_items (
  id uuid primary key default gen_random_uuid(),
  meal_id uuid not null references meals(id) on delete cascade,
  recipe_id uuid not null references recipes(id),
  servings_eaten numeric not null default 1,
  note text
);

alter table meal_items enable row level security;
create policy "meal_items_select" on meal_items for select
  using (exists (select 1 from meals m where m.id = meal_id and m.user_id = auth.uid()));
create policy "meal_items_insert" on meal_items for insert
  with check (exists (select 1 from meals m where m.id = meal_id and m.user_id = auth.uid()));
create policy "meal_items_update" on meal_items for update
  using (exists (select 1 from meals m where m.id = meal_id and m.user_id = auth.uid()));
create policy "meal_items_delete" on meal_items for delete
  using (exists (select 1 from meals m where m.id = meal_id and m.user_id = auth.uid()));

-- 6. 库存（留位，本阶段不用）
create table inventory (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id),
  ingredient_id uuid references ingredients(id),
  quantity numeric, unit text, storage text,
  purchase_date date, status text,
  receipt_raw_name text,
  price numeric, note text
);

alter table inventory enable row level security;
create policy "inventory_select" on inventory for select using (user_id = auth.uid());
create policy "inventory_insert" on inventory for insert with check (user_id = auth.uid());
create policy "inventory_update" on inventory for update using (user_id = auth.uid());
create policy "inventory_delete" on inventory for delete using (user_id = auth.uid());

-- 7. 身体数据（留位）
create table body_metrics (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id),
  recorded_on date, weight numeric, waist numeric,
  energy_level int, note text
);

alter table body_metrics enable row level security;
create policy "body_metrics_select" on body_metrics for select using (user_id = auth.uid());
create policy "body_metrics_insert" on body_metrics for insert with check (user_id = auth.uid());
create policy "body_metrics_update" on body_metrics for update using (user_id = auth.uid());
create policy "body_metrics_delete" on body_metrics for delete using (user_id = auth.uid());

-- 8. 目标（留位）
create table targets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id),
  daily_protein_g numeric default 110,
  daily_kcal numeric default 1900,
  note text
);

alter table targets enable row level security;
create policy "targets_select" on targets for select using (user_id = auth.uid());
create policy "targets_insert" on targets for insert with check (user_id = auth.uid());
create policy "targets_update" on targets for update using (user_id = auth.uid());
create policy "targets_delete" on targets for delete using (user_id = auth.uid());
