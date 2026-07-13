-- ============================================================
-- Diet Tracker · Step 4：验收查询
-- 逐条在 Supabase SQL 编辑器里跑，对照黄金值打勾
-- ============================================================

-- ── §7.1 行数验收 ──────────────────────────────────────────
select 'ingredients' as table_name, count(*) from ingredients
union all
select 'recipes',    count(*) from recipes
union all
select 'recipe_items', count(*) from recipe_items;
-- 期望：63 / 41 / 104

-- ── §7.2 营养黄金值 ────────────────────────────────────────

-- 番茄炖牛腩：total_kcal ≈ 1113，total_protein ≈ 75.6，per_serving_kcal ≈ 278
select name, round(total_kcal::numeric, 1) as total_kcal,
             round(total_protein::numeric, 1) as total_protein,
             round(per_serving_kcal::numeric, 1) as per_serving_kcal
from recipe_nutrition where name = '番茄炖牛腩';

-- 酸奶碗：total_kcal ≈ 175，total_protein ≈ 18.3
select name, round(total_kcal::numeric, 1) as total_kcal,
             round(total_protein::numeric, 1) as total_protein
from recipe_nutrition where name = '酸奶碗';

-- 三文鱼蔬菜面：total_kcal ≈ 895，total_protein ≈ 63.9
select name, round(total_kcal::numeric, 1) as total_kcal,
             round(total_protein::numeric, 1) as total_protein
from recipe_nutrition where name = '三文鱼蔬菜面';

-- ── §7.3 all_verified 验证 ─────────────────────────────────
-- 含参考值食材的配方 → all_verified = false
select name, all_verified from recipe_nutrition where name = '番茄炖牛腩';
-- 期望：false（牛腩等食材 is_verified=false）

-- 全实测配方（两个 is_verified=true 食材组成）
-- St Michel饼干：只含 St Michel饼干galettes（is_verified=true）
select name, all_verified from recipe_nutrition where name = 'St Michel饼干';
-- 期望：true

-- ── §7.4 完整链路测试（recipe→meal→daily）──────────────────
-- 手动插一条 2026-06-26 的午餐：番茄炖牛腩 1份 + 酸奶碗 1份
do $$
declare
  test_meal_id uuid;
begin
  insert into meals (user_id, eaten_on, meal_type)
  values ((select id from auth.users limit 1), '2026-06-26', '午餐')
  returning id into test_meal_id;

  insert into meal_items (meal_id, recipe_id, servings_eaten)
  select test_meal_id, id, 1 from recipes where name = '番茄炖牛腩';

  insert into meal_items (meal_id, recipe_id, servings_eaten)
  select test_meal_id, id, 1 from recipes where name = '酸奶碗';
end $$;

-- 查 meal_nutrition：应该看到这顿饭的合计
select eaten_on, meal_type,
       round(kcal::numeric, 1)    as kcal,
       round(protein::numeric, 1) as protein
from meal_nutrition where eaten_on = '2026-06-26';
-- 期望：kcal ≈ 278 + 175 = 453，protein ≈ 18.9 + 18.3 = 37.2（各取 per_serving）

-- 查 daily_summary：与上面应一致
select eaten_on,
       round(total_kcal::numeric, 1)    as total_kcal,
       round(total_protein::numeric, 1) as total_protein
from daily_summary where eaten_on = '2026-06-26';

-- ── §7.5 RLS 验证 ──────────────────────────────────────────
-- Supabase SQL 编辑器默认用 service_role（超管），会绕过 RLS
-- 下面的语句模拟「以你的账号身份」查询，验证 RLS policy 有没有配错
-- 先把你的 user_id 填进去（从 Authentication > Users 里复制）
-- 如果看到数据，说明 RLS 对你自己的账号放行正确

set local role authenticated;
set local "request.jwt.claims" to '{"sub": "在这里粘贴你的user_id_UUID"}';
select count(*) as visible_ingredients from ingredients;
-- 期望：63（你自己的数据全部可见）

-- 恢复超管权限（每次 SQL 编辑器会话结束自动重置，这里显式写一下）
reset role;
reset "request.jwt.claims";

-- ── §7.6 前端契约验证（确认这些查询都能跑） ────────────────
-- 当日视图
select * from daily_summary where eaten_on = current_date;

-- 配方选择器（按 role 分组）
select role, count(*) from recipes group by role order by role;

-- 对照 targets（先插一条默认目标）
insert into targets (user_id) values ((select id from auth.users limit 1))
on conflict do nothing;

select
  ds.eaten_on,
  ds.total_kcal,
  ds.total_protein,
  t.daily_kcal as target_kcal,
  t.daily_protein_g as target_protein,
  round((ds.total_kcal / t.daily_kcal * 100)::numeric, 0) as kcal_pct,
  round((ds.total_protein / t.daily_protein_g * 100)::numeric, 0) as protein_pct
from daily_summary ds
cross join (select daily_kcal, daily_protein_g from targets limit 1) t
where ds.eaten_on = '2026-06-26';
