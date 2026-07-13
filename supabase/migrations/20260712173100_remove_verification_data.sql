-- Remove only the known Phase 2 verification rows. Child meal_items and
-- cook_items rows are removed by ON DELETE CASCADE.

delete from public.meals m
where m.eaten_on = date '2026-06-26'
  and m.meal_type = '晚餐'
  and exists (
    select 1
    from public.meal_items mi
    join public.cook_sessions cs on cs.id = mi.cook_session_id
    where mi.meal_id = m.id
      and cs.name = '三文鱼蔬菜面测试'
  );

delete from public.cook_sessions
where name = '三文鱼蔬菜面测试'
  and cooked_on = date '2026-06-26';
