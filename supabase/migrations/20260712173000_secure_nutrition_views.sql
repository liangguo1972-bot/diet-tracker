-- Make all exposed nutrition views execute with the caller's permissions so
-- the underlying table RLS policies remain effective.

alter view public.recipe_nutrition set (security_invoker = true);
alter view public.cook_nutrition set (security_invoker = true);
alter view public.meal_nutrition set (security_invoker = true);
alter view public.daily_summary set (security_invoker = true);
