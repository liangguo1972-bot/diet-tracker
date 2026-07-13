-- ============================================================
-- Diet Tracker · 结构升级 Step 1+2+3
-- 新增 cook_sessions / cook_items；ingredients 加 serving_grams；
-- meal_items 改引用（去 recipe_id，加 cook_session_id/ingredient_id）
-- 在 Supabase SQL 编辑器分段运行（建议按下面的注释分块跑，方便逐步验证）
-- ============================================================

-- ── Step 1：新增 cook_sessions（实际做的一锅） ──────────────
create table cook_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id),
  cooked_on date not null default current_date,
  recipe_id uuid references recipes(id),
  name text,
  total_servings numeric not null default 1,
  note text
);

alter table cook_sessions enable row level security;
create policy "cook_sessions_select" on cook_sessions for select using (user_id = auth.uid());
create policy "cook_sessions_insert" on cook_sessions for insert with check (user_id = auth.uid());
create policy "cook_sessions_update" on cook_sessions for update using (user_id = auth.uid());
create policy "cook_sessions_delete" on cook_sessions for delete using (user_id = auth.uid());

-- ── Step 1：新增 cook_items（这一锅实际放的食材，真实克数） ──
create table cook_items (
  id uuid primary key default gen_random_uuid(),
  cook_session_id uuid not null references cook_sessions(id) on delete cascade,
  ingredient_id uuid not null references ingredients(id),
  grams numeric not null,
  note text
);

alter table cook_items enable row level security;
create policy "cook_items_select" on cook_items for select
  using (exists (select 1 from cook_sessions cs where cs.id = cook_session_id and cs.user_id = auth.uid()));
create policy "cook_items_insert" on cook_items for insert
  with check (exists (select 1 from cook_sessions cs where cs.id = cook_session_id and cs.user_id = auth.uid()));
create policy "cook_items_update" on cook_items for update
  using (exists (select 1 from cook_sessions cs where cs.id = cook_session_id and cs.user_id = auth.uid()));
create policy "cook_items_delete" on cook_items for delete
  using (exists (select 1 from cook_sessions cs where cs.id = cook_session_id and cs.user_id = auth.uid()));


-- ── Step 2：ingredients 加 serving_grams，回填已知值 ────────
alter table ingredients add column serving_grams numeric;

update ingredients set serving_grams = 50  where name = '鸡蛋';
update ingredients set serving_grams = 40  where name = '燕麦(干)';
update ingredients set serving_grams = 28  where name = '全麦面包';
update ingredients set serving_grams = 60  where name = '口袋面包 pita';
update ingredients set serving_grams = 100 where name = '牛油果';
update ingredients set serving_grams = 15  where name = '混合坚果';
update ingredients set serving_grams = 14  where name = '橄榄油';
update ingredients set serving_grams = 118 where name = '香蕉';
update ingredients set serving_grams = 180 where name = '苹果';
update ingredients set serving_grams = 100 where name = 'everything贝果';
update ingredients set serving_grams = 33  where name = 'St Michel饼干galettes';


-- ── Step 3 前置：先看一眼现有 meal_items，确认都是可丢的演示/测试数据 ──
-- 运行这条，把结果发给我确认后，再继续往下跑 Step 3 的 alter/drop
select mi.*, m.eaten_on, m.meal_type, r.name as recipe_name
from meal_items mi
join meals m on m.id = mi.meal_id
left join recipes r on r.id = mi.recipe_id;


-- ── Step 3：meal_items 改引用（确认上面数据可丢之后再运行下面） ──
alter table meal_items add column cook_session_id uuid references cook_sessions(id);
alter table meal_items add column ingredient_id uuid references ingredients(id);

drop policy "meal_items_select" on meal_items;
drop policy "meal_items_insert" on meal_items;
drop policy "meal_items_update" on meal_items;
drop policy "meal_items_delete" on meal_items;

alter table meal_items drop column recipe_id;

alter table meal_items add constraint meal_item_one_source
  check ( (cook_session_id is not null)::int + (ingredient_id is not null)::int = 1 );

create policy "meal_items_select" on meal_items for select
  using (exists (select 1 from meals m where m.id = meal_id and m.user_id = auth.uid()));
create policy "meal_items_insert" on meal_items for insert
  with check (exists (select 1 from meals m where m.id = meal_id and m.user_id = auth.uid()));
create policy "meal_items_update" on meal_items for update
  using (exists (select 1 from meals m where m.id = meal_id and m.user_id = auth.uid()));
create policy "meal_items_delete" on meal_items for delete
  using (exists (select 1 from meals m where m.id = meal_id and m.user_id = auth.uid()));
