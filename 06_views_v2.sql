-- ============================================================
-- Diet Tracker · 结构升级 Step 4
-- 新增 cook_nutrition；重写 meal_nutrition（两条路 union）；
-- daily_summary 重建（依赖 meal_nutrition，之前被 drop 了）
-- recipe_nutrition 不动（已存在，未受影响）
-- ============================================================

-- ── 新增：cook_nutrition（那一锅的整批/每份营养） ───────────
create view cook_nutrition as
select
  cs.id as cook_session_id,
  cs.name,
  cs.cooked_on,
  cs.total_servings,
  sum(ci.grams/100.0 * i.kcal_per_100g)    as total_kcal,
  sum(ci.grams/100.0 * i.protein_per_100g) as total_protein,
  sum(ci.grams/100.0 * i.carb_per_100g)    as total_carb,
  sum(ci.grams/100.0 * i.fat_per_100g)     as total_fat,
  sum(ci.grams/100.0 * i.kcal_per_100g)    / nullif(cs.total_servings,0) as per_serving_kcal,
  sum(ci.grams/100.0 * i.protein_per_100g) / nullif(cs.total_servings,0) as per_serving_protein,
  sum(ci.grams/100.0 * i.carb_per_100g)    / nullif(cs.total_servings,0) as per_serving_carb,
  sum(ci.grams/100.0 * i.fat_per_100g)     / nullif(cs.total_servings,0) as per_serving_fat,
  bool_and(i.is_verified) as all_verified
from cook_sessions cs
join cook_items ci on ci.cook_session_id = cs.id
join ingredients i on i.id = ci.ingredient_id
group by cs.id, cs.name, cs.cooked_on, cs.total_servings;


-- ── 重写：meal_nutrition（路 A：吃那一锅 UNION 路 B：吃单品） ──
create view meal_nutrition as
select
  m.id as meal_id,
  m.eaten_on,
  m.meal_type,
  sum(x.kcal)    as kcal,
  sum(x.protein) as protein,
  sum(x.carb)    as carb,
  sum(x.fat)     as fat
from meals m
join (
  -- 路 A：吃那一锅做的菜
  select
    mi.meal_id,
    mi.servings_eaten * cn.per_serving_kcal    as kcal,
    mi.servings_eaten * cn.per_serving_protein as protein,
    mi.servings_eaten * cn.per_serving_carb    as carb,
    mi.servings_eaten * cn.per_serving_fat     as fat
  from meal_items mi
  join cook_nutrition cn on cn.cook_session_id = mi.cook_session_id
  where mi.cook_session_id is not null

  union all

  -- 路 B：吃单品（按 serving_grams 定义的份数）
  select
    mi.meal_id,
    mi.servings_eaten * (i.serving_grams/100.0) * i.kcal_per_100g    as kcal,
    mi.servings_eaten * (i.serving_grams/100.0) * i.protein_per_100g as protein,
    mi.servings_eaten * (i.serving_grams/100.0) * i.carb_per_100g    as carb,
    mi.servings_eaten * (i.serving_grams/100.0) * i.fat_per_100g     as fat
  from meal_items mi
  join ingredients i on i.id = mi.ingredient_id
  where mi.ingredient_id is not null
) x on x.meal_id = m.id
group by m.id, m.eaten_on, m.meal_type;


-- ── 重建：daily_summary（之前被 drop，依赖 meal_nutrition） ──
create view daily_summary as
select
  eaten_on,
  sum(kcal)    as total_kcal,
  sum(protein) as total_protein,
  sum(carb)    as total_carb,
  sum(fat)     as total_fat
from meal_nutrition
group by eaten_on;
