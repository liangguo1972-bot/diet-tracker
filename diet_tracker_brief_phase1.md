# 饮食追踪工具 · 阶段 1 Brief：只做数据层（给 Claude Code）

> 这一阶段**一行前端都不碰**。只做：Supabase 建表 + 营养计算 view + RLS + 导入 seed。所有验收都在 Supabase 的 SQL 编辑器里完成。
>
> 请先通读，进入 plan 模式复述你的理解和实现步骤，等我确认后再动手。

---

## 1. 这一阶段做什么 / 不做什么

**做**：把数据模型在 Supabase 里建对、把营养计算逻辑用 view 实现并验证正确、导入我现有的数据（seed）。

**不做**：任何前端、界面、四态、API 封装（Supabase 自动生成的 REST/SDK 就够，这阶段不碰）。

**为什么先做这个**：数据模型是地基。先在数据库里把结构和营养计算验证对，前端以后按这个结构接。验收靠 SQL 查询，不靠界面。

**一个设计约束（契约思维）**：虽然这阶段不写前端，但建表时心里要装着前端以后会怎么读这些数据（见 §5），确保结构支持那些读法，避免以后回头改 schema。

---

## 2. 技术栈

- **Supabase**（Postgres + Auth）。
- **单用户**：建我自己一个账号。每张业务表加 `user_id`，开 RLS，policy = `user_id = auth.uid()`。这是 Supabase 标准模式，也是我最需要你讲清楚、并教我怎么验证的一块（非技术用户最常卡在 RLS 配错导致读不到数据）。

---

## 3. 数据模型（DDL）

设计原则：
- 营养统一按**每 100g**存。计件食材（鸡蛋、面包片）已在 seed 里换算成每 100g，每单位克重写在 note。
- 营养**不存死值**，用 view 实时算（见 §4）。`recipes`、`meals` 表里没有营养列。
- **单品也是配方**：一根贝果、一份饼干就是只含 1 个 `recipe_items` 的 recipe。这样以后「每餐记录」只引用 `recipes` 一个来源。

```sql
-- 食材库
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
  is_verified boolean default false,   -- 实测(true) vs 参考值占位(false)
  note text,
  unique (user_id, name)
);

-- 配方
create table recipes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id),
  name text not null,
  role text,                            -- 蛋白主菜/蔬菜/汤/主食/组装餐/snack
  servings numeric not null default 1,  -- 典型份数(做一锅吃几顿);单品填1
  note text,
  unique (user_id, name)
);

-- 配方明细(配方 = 食材组合,生重)
create table recipe_items (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references recipes(id) on delete cascade,
  ingredient_id uuid not null references ingredients(id),
  grams numeric not null,
  note text
);

-- 一餐
create table meals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id),
  eaten_on date not null default current_date,
  meal_type text,                       -- 早餐/午餐/晚餐/加餐/早午餐
  note text
);

-- 一餐吃了哪些配方各几份
create table meal_items (
  id uuid primary key default gen_random_uuid(),
  meal_id uuid not null references meals(id) on delete cascade,
  recipe_id uuid not null references recipes(id),
  servings_eaten numeric not null default 1,
  note text
);

-- 以下留位:本阶段建表,不写任何功能
create table inventory (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id),
  ingredient_id uuid references ingredients(id),
  quantity numeric, unit text, storage text,
  purchase_date date, status text,
  receipt_raw_name text,                -- 收据原名,映射用
  price numeric, note text
);
create table body_metrics (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id),
  recorded_on date, weight numeric, waist numeric,
  energy_level int, note text
);
create table targets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id),
  daily_protein_g numeric default 110,
  daily_kcal numeric default 1900,
  note text
);
```

每张带 `user_id` 的表都要：`enable row level security`，并加 policy（select/insert/update/delete）`using (user_id = auth.uid())`。`recipe_items` 和 `meal_items` 通过父表关联，policy 用 `exists` 子查询校验父行属于当前用户。

---

## 4. 营养计算 view（核心逻辑，按这里实现，别自由发挥）

**生重相加原理**：烹饪只脱水、总热量不变，所以配方营养 = 各食材（生重 ÷ 100 × 每 100g 营养）之和。

```sql
-- 配方营养:整批 + 每份
create view recipe_nutrition as
select
  r.id as recipe_id, r.name, r.servings,
  sum(ri.grams/100.0 * i.kcal_per_100g)    as total_kcal,
  sum(ri.grams/100.0 * i.protein_per_100g) as total_protein,
  sum(ri.grams/100.0 * i.carb_per_100g)    as total_carb,
  sum(ri.grams/100.0 * i.fat_per_100g)     as total_fat,
  sum(ri.grams/100.0 * i.kcal_per_100g)    / nullif(r.servings,0) as per_serving_kcal,
  sum(ri.grams/100.0 * i.protein_per_100g) / nullif(r.servings,0) as per_serving_protein,
  sum(ri.grams/100.0 * i.carb_per_100g)    / nullif(r.servings,0) as per_serving_carb,
  sum(ri.grams/100.0 * i.fat_per_100g)     / nullif(r.servings,0) as per_serving_fat,
  bool_and(i.is_verified) as all_verified   -- 全部实测才 true;含参考值则 false(前端据此标"估")
from recipes r
join recipe_items ri on ri.recipe_id = r.id
join ingredients i  on i.id = ri.ingredient_id
group by r.id, r.name, r.servings;

-- 每餐营养 = 每份 × 吃了几份
create view meal_nutrition as
select
  m.id as meal_id, m.eaten_on, m.meal_type,
  sum(mi.servings_eaten * rn.per_serving_kcal)    as kcal,
  sum(mi.servings_eaten * rn.per_serving_protein) as protein,
  sum(mi.servings_eaten * rn.per_serving_carb)    as carb,
  sum(mi.servings_eaten * rn.per_serving_fat)     as fat
from meals m
join meal_items mi on mi.meal_id = m.id
join recipe_nutrition rn on rn.recipe_id = mi.recipe_id
group by m.id, m.eaten_on, m.meal_type;

-- 日总结 = 按日期汇总(对账在"每天"层,不是每餐)
create view daily_summary as
select
  eaten_on,
  sum(kcal) as total_kcal,
  sum(protein) as total_protein,
  sum(carb) as total_carb,
  sum(fat) as total_fat
from meal_nutrition
group by eaten_on;
```

注意：营养链里某食材 `is_verified=false` 是正常的（我还没拍标签，先用参考值）。**绝不能因此报错或拦截**，照常计算，`all_verified` 字段供前端以后标「估」。

---

## 5. 契约思维：前端以后会怎么读（本阶段不实现，只确保结构支持）

列在这里是为了让你建 schema 时确认这些读法都查得出来：

- 当日视图：`select * from daily_summary where eaten_on = $1` + 当天各餐明细
- 缺口：当日 total 对照 `targets`（蛋白 110、热量 1900）
- 配方选择器：`select * from recipes order by role`（按角色分组）
- 「估」标记：读 `recipe_nutrition.all_verified`

如果上面任何一条查不出来，说明 schema 设计有问题，现在就调。

---

## 6. Seed 数据（随附三个 CSV）

我现有的数据，直接导入，不用重输：

- `seed_ingredients.csv`（63 个食材）→ `ingredients`
- `seed_recipes.csv`（41 个配方）→ `recipes`
- `seed_recipe_items.csv`（104 行）→ `recipe_items`，用 **name 关联**：导入时按 `recipe_name` 查 `recipes.id`、按 `ingredient_name` 查 `ingredients.id`。

注意：大部分食材 `is_verified=false`（参考值），少数 true（金枪鱼罐头、St Michel 饼干是我拍标签的实测）。导入时把所有行的 `user_id` 设成我的账号。

---

## 7. 验收（全部在 Supabase SQL 编辑器，不碰前端）

逐条可勾：

- [ ] 8 张表 + 3 个 view 全部建好
- [ ] 每张业务表 RLS 已开、policy 已配；用我的账号能读写、并告诉我怎么验证只能读到自己的数据
- [ ] seed 导入成功：`select count(*) from ingredients` = 63、`recipes` = 41、`recipe_items` = 104
- [ ] **营养计算对**（黄金值核对，用我 Excel 已知的数）：
  - `select * from recipe_nutrition where name='番茄炖牛腩'` → total_kcal ≈ **1113**、total_protein ≈ **75.6**、per_serving_kcal ≈ **278**（servings=4）
  - `select * from recipe_nutrition where name='酸奶碗'` → total_kcal ≈ **175**、total_protein ≈ **18.3**
  - `select * from recipe_nutrition where name='三文鱼蔬菜面'` → total_kcal ≈ **895**、total_protein ≈ **63.9**
  - 数对得上，说明生重相加链通了
- [ ] `recipe_nutrition.all_verified` 对含参考值的配方返回 false、对全实测的返回 true
- [ ] 手动插一条 meal + 两条 meal_items（番茄炖牛腩 1 份 + 酸奶碗 1 份），查 `meal_nutrition` 和 `daily_summary`，数值 = 两者相加

最后一条 meal 测试可以用 SQL 直接 insert 验证整条链（recipe→meal→daily），完全不需要前端。

---

## 8. 跟我协作

1. **先 plan 再写**：复述理解 + 列步骤，我确认再动手。
2. **数据库这层多解释**：我前端熟、后端没碰过。RLS、view、怎么在 SQL 编辑器验证，请每步说清「在干什么、怎么确认对」。
3. **顺序**：先建表 + RLS → 导 seed → 建 view → 跑 §7 验收。一步一停，别一次全做完。

### 这一阶段的交付

一个能在 Supabase 里跑通、§7 全部打勾的数据库。前端是下一阶段的事。
