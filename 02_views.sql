-- ============================================================
-- Diet Tracker · Step 2：营养计算 view
-- 在 01_schema.sql 运行成功后再跑这个
-- ============================================================

-- 配方营养：整批 + 每份
create view recipe_nutrition as
select
  r.id as recipe_id,
  r.name,
  r.servings,
  sum(ri.grams / 100.0 * i.kcal_per_100g)    as total_kcal,
  sum(ri.grams / 100.0 * i.protein_per_100g) as total_protein,
  sum(ri.grams / 100.0 * i.carb_per_100g)    as total_carb,
  sum(ri.grams / 100.0 * i.fat_per_100g)     as total_fat,
  sum(ri.grams / 100.0 * i.kcal_per_100g)    / nullif(r.servings, 0) as per_serving_kcal,
  sum(ri.grams / 100.0 * i.protein_per_100g) / nullif(r.servings, 0) as per_serving_protein,
  sum(ri.grams / 100.0 * i.carb_per_100g)    / nullif(r.servings, 0) as per_serving_carb,
  sum(ri.grams / 100.0 * i.fat_per_100g)     / nullif(r.servings, 0) as per_serving_fat,
  bool_and(i.is_verified) as all_verified
from recipes r
join recipe_items ri on ri.recipe_id = r.id
join ingredients i  on i.id = ri.ingredient_id
group by r.id, r.name, r.servings;

-- 每餐营养 = 每份 × 吃了几份
create view meal_nutrition as
select
  m.id as meal_id,
  m.eaten_on,
  m.meal_type,
  sum(mi.servings_eaten * rn.per_serving_kcal)    as kcal,
  sum(mi.servings_eaten * rn.per_serving_protein) as protein,
  sum(mi.servings_eaten * rn.per_serving_carb)    as carb,
  sum(mi.servings_eaten * rn.per_serving_fat)     as fat
from meals m
join meal_items mi       on mi.meal_id = m.id
join recipe_nutrition rn on rn.recipe_id = mi.recipe_id
group by m.id, m.eaten_on, m.meal_type;

-- 日总结
create view daily_summary as
select
  eaten_on,
  sum(kcal)    as total_kcal,
  sum(protein) as total_protein,
  sum(carb)    as total_carb,
  sum(fat)     as total_fat
from meal_nutrition
group by eaten_on;
