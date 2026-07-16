-- Personal account seed support.
-- Stable ingredient and recipe keys make the reviewed CSV imports repeatable
-- without tying references to mutable display names.

alter table public.ingredients
  add column canonical_name text,
  add column common_name_en text,
  add column is_spec_sensitive boolean not null default false,
  add column nutrition_source text,
  add column seed_source text;

update public.ingredients
set canonical_name = name
where canonical_name is null;

alter table public.ingredients
  alter column canonical_name set not null,
  add constraint ingredients_canonical_name_not_blank
    check (btrim(canonical_name) <> '');

create unique index ingredients_user_canonical_name_idx
  on public.ingredients (user_id, lower(btrim(canonical_name)));

create or replace function public.ensure_ingredient_canonical_name()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if nullif(btrim(new.canonical_name), '') is null then
    new.canonical_name := btrim(new.name);
  end if;
  return new;
end;
$$;

create trigger ingredients_ensure_canonical_name
before insert or update of canonical_name on public.ingredients
for each row execute function public.ensure_ingredient_canonical_name();

alter table public.recipes
  add column seed_key text,
  add column seed_source text;

create unique index recipes_user_seed_key_idx
  on public.recipes (user_id, seed_key)
  where seed_key is not null;

alter table public.ingredient_aliases
  add column source text not null default 'user_confirmed',
  add constraint ingredient_aliases_source_check
    check (source in ('user_confirmed', 'personal_seed', 'seed_inventory_conversion'));

create table public.ingredient_match_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  ingredient_id uuid not null references public.ingredients(id) on delete cascade,
  alias text not null check (btrim(alias) <> ''),
  normalized_alias text not null check (btrim(normalized_alias) <> ''),
  keywords text[] not null default '{}',
  ignored_terms text[] not null default '{}',
  match_risk text not null check (match_risk in ('safe', 'needs_confirm', 'high_risk')),
  reason text,
  source text not null default 'personal_seed' check (source = 'personal_seed'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, normalized_alias)
);

create index ingredient_match_rules_user_ingredient_idx
  on public.ingredient_match_rules (user_id, ingredient_id);

alter table public.ingredient_match_rules enable row level security;
revoke all on public.ingredient_match_rules from anon, authenticated;

alter table public.receipt_items
  drop constraint receipt_items_suggestion_source_check,
  add constraint receipt_items_suggestion_source_check
    check (suggestion_source is null or suggestion_source in ('name_similarity', 'openai', 'seed_dictionary'));

create or replace function public.apply_personal_seed_receipt_rule()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_rule public.ingredient_match_rules%rowtype;
  v_ingredient_name text;
begin
  if new.ingredient_id is not null or nullif(btrim(new.raw_name), '') is null then
    return new;
  end if;

  select ri.user_id into v_user_id
  from public.receipt_imports ri
  where ri.id = new.receipt_import_id;

  if v_user_id is null then
    return new;
  end if;

  select imr.* into v_rule
  from public.ingredient_match_rules imr
  where imr.user_id = v_user_id
    and imr.normalized_alias = public.normalize_receipt_name(new.raw_name)
  limit 1;

  if not found then
    return new;
  end if;

  select i.name into v_ingredient_name
  from public.ingredients i
  where i.id = v_rule.ingredient_id and i.user_id = v_user_id;

  if v_ingredient_name is null then
    return new;
  end if;

  if v_rule.match_risk = 'safe' then
    new.ingredient_id := v_rule.ingredient_id;
    new.suggested_ingredient_id := null;
    new.suggested_name := null;
    new.suggestion_confidence := null;
    new.suggestion_reason := null;
    new.suggestion_source := null;
    new.match_status := 'matched';
    new.match_confidence := 0.98;
  else
    new.suggested_ingredient_id := v_rule.ingredient_id;
    new.suggested_name := v_ingredient_name;
    new.suggestion_confidence := case when v_rule.match_risk = 'needs_confirm' then 0.85 else 0.6 end;
    new.suggestion_reason := coalesce(nullif(btrim(v_rule.reason), ''), '基础词典建议，需要确认规格');
    new.suggestion_source := 'seed_dictionary';
    new.match_status := 'possible_match';
    new.match_confidence := new.suggestion_confidence;
  end if;

  return new;
end;
$$;

create trigger receipt_items_apply_personal_seed_rule
before insert on public.receipt_items
for each row execute function public.apply_personal_seed_receipt_rule();

revoke all on function public.ensure_ingredient_canonical_name() from public, anon, authenticated;
revoke all on function public.apply_personal_seed_receipt_rule() from public, anon, authenticated;
