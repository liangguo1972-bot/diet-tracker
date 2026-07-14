-- Candidate drawing uses random(), so it must not be declared STABLE.

alter function public.draw_recipe_candidates(integer) volatile;
