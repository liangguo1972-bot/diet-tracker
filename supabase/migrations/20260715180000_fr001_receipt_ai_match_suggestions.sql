-- FR-001: optional AI suggestions after Azure receipt line extraction.
-- Suggested ingredients stay separate from confirmed ingredient_id so a
-- possible match can never enter inventory or aliases without user action.

alter table public.receipt_items
  add column suggested_ingredient_id uuid references public.ingredients(id) on delete restrict,
  add column suggested_name text,
  add column suggestion_confidence numeric,
  add column suggestion_reason text,
  add column suggestion_source text,
  add constraint receipt_items_suggestion_confidence_check
    check (suggestion_confidence is null or (suggestion_confidence >= 0 and suggestion_confidence <= 1)),
  add constraint receipt_items_suggestion_source_check
    check (suggestion_source is null or suggestion_source in ('name_similarity', 'openai'));

alter table public.receipt_imports
  add column suggestion_status text not null default 'not_requested',
  add column suggestion_provider text,
  add constraint receipt_imports_suggestion_status_check
    check (suggestion_status in ('not_requested', 'not_configured', 'applied', 'unavailable', 'rate_limited'));

-- Move existing fuzzy candidates out of the confirmed ingredient column.
update public.receipt_items
set suggested_ingredient_id = ingredient_id,
    suggested_name = i.name,
    suggestion_confidence = match_confidence,
    suggestion_reason = '名称相似，需要确认',
    suggestion_source = 'name_similarity',
    ingredient_id = null
from public.ingredients i
where public.receipt_items.match_status = 'possible_match'
  and public.receipt_items.ingredient_id = i.id;

create table public.receipt_ai_match_policy (
  singleton boolean primary key default true check (singleton),
  max_items integer not null check (max_items between 1 and 500),
  daily_limit integer not null check (daily_limit between 1 and 1000),
  monthly_limit integer not null check (monthly_limit between 1 and 10000),
  updated_at timestamptz not null default now()
);

insert into public.receipt_ai_match_policy (singleton, max_items, daily_limit, monthly_limit)
values (true, 100, 10, 100);

create table public.receipt_ai_match_calls (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  receipt_import_id uuid not null references public.receipt_imports(id) on delete cascade,
  input_hash text not null check (btrim(input_hash) <> ''),
  item_count integer not null check (item_count > 0),
  provider text not null,
  model text not null,
  status text not null default 'processing' check (status in ('processing', 'succeeded', 'failed')),
  response jsonb,
  error_code text,
  input_tokens integer check (input_tokens is null or input_tokens >= 0),
  output_tokens integer check (output_tokens is null or output_tokens >= 0),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index receipt_ai_match_calls_user_created_idx
  on public.receipt_ai_match_calls (user_id, created_at desc);
create index receipt_ai_match_calls_cache_idx
  on public.receipt_ai_match_calls (receipt_import_id, input_hash, provider, model, created_at desc);

alter table public.receipt_ai_match_policy enable row level security;
alter table public.receipt_ai_match_calls enable row level security;

revoke all on public.receipt_ai_match_policy, public.receipt_ai_match_calls from public, anon, authenticated;

create or replace function public.claim_receipt_ai_match_call(
  p_receipt_import_id uuid,
  p_input_hash text,
  p_item_count integer,
  p_provider text,
  p_model text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_policy public.receipt_ai_match_policy%rowtype;
  v_cached_response jsonb;
  v_daily_used integer;
  v_monthly_used integer;
  v_call_id uuid;
  v_day_start timestamptz := date_trunc('day', now() at time zone 'UTC') at time zone 'UTC';
  v_month_start timestamptz := date_trunc('month', now() at time zone 'UTC') at time zone 'UTC';
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;
  select * into v_policy from public.receipt_ai_match_policy where singleton = true;
  if not found then
    raise exception 'RECEIPT_MATCH_NOT_CONFIGURED' using errcode = 'P0001';
  end if;
  if p_receipt_import_id is null or nullif(btrim(p_input_hash), '') is null
     or p_item_count is null or p_item_count <= 0 or p_item_count > v_policy.max_items
     or nullif(btrim(p_provider), '') is null or nullif(btrim(p_model), '') is null then
    raise exception 'RECEIPT_MATCH_INPUT_INVALID' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.receipt_imports ri
    where ri.id = p_receipt_import_id and ri.user_id = v_user_id
      and ri.status in ('uploaded', 'processing', 'failed')
  ) then
    raise exception 'INVALID_REFERENCE' using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    v_user_id::text || ':receipt_ai_match:' || p_receipt_import_id::text || ':' || btrim(p_input_hash), 0
  ));

  select response into v_cached_response
  from public.receipt_ai_match_calls
  where user_id = v_user_id
    and receipt_import_id = p_receipt_import_id
    and input_hash = btrim(p_input_hash)
    and provider = btrim(p_provider)
    and model = btrim(p_model)
    and status = 'succeeded'
    and response is not null
  order by created_at desc
  limit 1;
  if found then
    return jsonb_build_object('mode', 'cached', 'response', v_cached_response);
  end if;

  if exists (
    select 1 from public.receipt_ai_match_calls
    where user_id = v_user_id
      and receipt_import_id = p_receipt_import_id
      and input_hash = btrim(p_input_hash)
      and provider = btrim(p_provider)
      and model = btrim(p_model)
      and status = 'processing'
      and created_at > now() - interval '2 minutes'
  ) then
    return jsonb_build_object('mode', 'busy');
  end if;

  select count(*)::integer into v_daily_used
  from public.receipt_ai_match_calls
  where user_id = v_user_id and created_at >= v_day_start;
  select count(*)::integer into v_monthly_used
  from public.receipt_ai_match_calls
  where user_id = v_user_id and created_at >= v_month_start;
  if v_daily_used >= v_policy.daily_limit or v_monthly_used >= v_policy.monthly_limit then
    raise exception 'RATE_LIMITED'
      using errcode = 'P0001', detail = jsonb_build_object(
        'dailyUsed', v_daily_used,
        'dailyLimit', v_policy.daily_limit,
        'monthlyUsed', v_monthly_used,
        'monthlyLimit', v_policy.monthly_limit
      )::text;
  end if;

  insert into public.receipt_ai_match_calls (
    user_id, receipt_import_id, input_hash, item_count, provider, model
  ) values (
    v_user_id, p_receipt_import_id, btrim(p_input_hash), p_item_count, btrim(p_provider), btrim(p_model)
  ) returning id into v_call_id;

  return jsonb_build_object(
    'mode', 'call',
    'matchCallId', v_call_id,
    'dailyUsed', v_daily_used + 1,
    'dailyLimit', v_policy.daily_limit,
    'monthlyUsed', v_monthly_used + 1,
    'monthlyLimit', v_policy.monthly_limit
  );
end;
$$;

create or replace function public.complete_receipt_ai_match_call(
  p_match_call_id uuid,
  p_status text,
  p_response jsonb default null,
  p_error_code text default null,
  p_input_tokens integer default null,
  p_output_tokens integer default null
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_match_call_id is null or p_status not in ('succeeded', 'failed')
     or (p_status = 'succeeded' and (p_response is null or jsonb_typeof(p_response) <> 'array'))
     or (p_input_tokens is not null and p_input_tokens < 0)
     or (p_output_tokens is not null and p_output_tokens < 0) then
    raise exception 'RECEIPT_MATCH_RESPONSE_INVALID' using errcode = '22023';
  end if;

  update public.receipt_ai_match_calls
  set status = p_status,
      response = case when p_status = 'succeeded' then p_response else null end,
      error_code = nullif(btrim(p_error_code), ''),
      input_tokens = p_input_tokens,
      output_tokens = p_output_tokens,
      completed_at = now()
  where id = p_match_call_id and status = 'processing';
  if not found then
    raise exception 'INVALID_REFERENCE' using errcode = 'P0001';
  end if;
end;
$$;

create or replace function public.get_receipt_import(p_receipt_import_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;
  if not exists (
    select 1 from public.receipt_imports where id = p_receipt_import_id and user_id = v_user_id
  ) then
    raise exception 'INVALID_REFERENCE' using errcode = 'P0001';
  end if;
  return (
    select jsonb_build_object(
      'receiptImportId', ri.id,
      'status', ri.status,
      'fileName', ri.file_name,
      'contentType', ri.content_type,
      'storagePath', ri.storage_path,
      'merchantName', ri.merchant_name,
      'purchasedOn', ri.purchased_on,
      'errorCode', ri.error_code,
      'suggestionStatus', ri.suggestion_status,
      'suggestionProvider', ri.suggestion_provider,
      'items', coalesce((
        select jsonb_agg(jsonb_build_object(
          'receiptItemId', ritem.id,
          'position', ritem.position,
          'rawLine', ritem.raw_line,
          'rawName', ritem.raw_name,
          'rawQuantity', ritem.raw_quantity,
          'rawUnit', ritem.raw_unit,
          'rawPrice', ritem.raw_price,
          'ingredientId', ritem.ingredient_id,
          'ingredientName', ing.name,
          'suggestedIngredientId', ritem.suggested_ingredient_id,
          'suggestedIngredientName', sing.name,
          'suggestedName', ritem.suggested_name,
          'suggestionConfidence', ritem.suggestion_confidence,
          'suggestionReason', ritem.suggestion_reason,
          'suggestionSource', ritem.suggestion_source,
          'matchStatus', ritem.match_status,
          'matchConfidence', ritem.match_confidence,
          'confirmedName', ritem.confirmed_name,
          'confirmedQuantity', ritem.confirmed_quantity,
          'confirmedUnit', ritem.confirmed_unit,
          'storage', ritem.storage,
          'action', ritem.action,
          'inventoryId', ritem.inventory_id
        ) order by ritem.position)
        from public.receipt_items ritem
        left join public.ingredients ing on ing.id = ritem.ingredient_id
        left join public.ingredients sing on sing.id = ritem.suggested_ingredient_id
        where ritem.receipt_import_id = ri.id
      ), '[]'::jsonb)
    )
    from public.receipt_imports ri
    where ri.id = p_receipt_import_id and ri.user_id = v_user_id
  );
end;
$$;

create or replace function public.apply_receipt_recognition(
  p_receipt_import_id uuid,
  p_raw_text text,
  p_items jsonb,
  p_provider text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_import public.receipt_imports%rowtype;
  v_item jsonb;
  v_position integer := 0;
  v_raw_name text;
  v_raw_quantity numeric;
  v_raw_unit text;
  v_raw_price numeric;
  v_confirmed_quantity numeric;
  v_confirmed_unit text;
  v_quantity_reliable boolean;
  v_ingredient_id uuid;
  v_suggested_ingredient_id uuid;
  v_suggested_name text;
  v_suggestion_confidence numeric;
  v_suggestion_reason text;
  v_suggestion_source text;
  v_match_status text;
  v_confidence numeric;
  v_normalized text;
begin
  if p_receipt_import_id is null or p_items is null or jsonb_typeof(p_items) <> 'array'
     or nullif(btrim(p_provider), '') is null then
    raise exception 'RECEIPT_RECOGNITION_INVALID' using errcode = '22023';
  end if;
  select * into v_import from public.receipt_imports where id = p_receipt_import_id for update;
  if not found then
    raise exception 'INVALID_REFERENCE' using errcode = 'P0001';
  end if;
  if v_import.status not in ('uploaded', 'processing', 'failed') then
    raise exception 'STATUS_CONFLICT' using errcode = 'P0001';
  end if;

  delete from public.receipt_items where receipt_import_id = v_import.id;
  for v_item in select value from jsonb_array_elements(p_items)
  loop
    begin
      v_raw_name := nullif(btrim(v_item ->> 'name'), '');
      v_raw_quantity := nullif(v_item ->> 'quantity', '')::numeric;
      v_raw_unit := nullif(btrim(v_item ->> 'unit'), '');
      v_raw_price := nullif(v_item ->> 'price', '')::numeric;
      v_suggested_ingredient_id := nullif(v_item ->> 'suggestedIngredientId', '')::uuid;
      v_suggested_name := nullif(btrim(v_item ->> 'suggestedName'), '');
      v_suggestion_confidence := nullif(v_item ->> 'suggestionConfidence', '')::numeric;
      v_suggestion_reason := left(nullif(btrim(v_item ->> 'suggestionReason'), ''), 300);
      v_suggestion_source := nullif(btrim(v_item ->> 'suggestionSource'), '');
    exception when others then
      raise exception 'RECEIPT_RECOGNITION_INVALID' using errcode = '22023';
    end;
    if v_raw_name is null
       or (v_suggestion_confidence is not null and (v_suggestion_confidence < 0 or v_suggestion_confidence > 1))
       or (v_suggestion_source is not null and v_suggestion_source not in ('name_similarity', 'openai')) then
      raise exception 'RECEIPT_RECOGNITION_INVALID' using errcode = '22023';
    end if;
    if v_suggested_ingredient_id is not null and not exists (
      select 1 from public.ingredients i
      where i.id = v_suggested_ingredient_id and i.user_id = v_import.user_id
    ) then
      raise exception 'RECEIPT_RECOGNITION_INVALID' using errcode = '22023';
    end if;
    if v_raw_quantity is not null and v_raw_quantity <= 0 then
      v_raw_quantity := null;
    end if;

    v_quantity_reliable := v_raw_quantity is not null
      and v_raw_unit is not null
      and (v_raw_price is null or abs(v_raw_quantity - v_raw_price) > 0.000001);
    if v_quantity_reliable then
      v_confirmed_quantity := v_raw_quantity;
      v_confirmed_unit := v_raw_unit;
    else
      v_confirmed_quantity := 1;
      v_confirmed_unit := '件';
    end if;

    v_normalized := public.normalize_receipt_name(v_raw_name);
    v_ingredient_id := null;
    v_match_status := 'unmatched';
    v_confidence := null;
    if v_normalized is not null then
      select ia.ingredient_id into v_ingredient_id
      from public.ingredient_aliases ia
      where ia.user_id = v_import.user_id and ia.normalized_alias = v_normalized;
      if found then
        v_match_status := 'matched';
        v_confidence := 1;
        v_suggested_ingredient_id := null;
        v_suggested_name := null;
        v_suggestion_confidence := null;
        v_suggestion_reason := null;
        v_suggestion_source := null;
      else
        select i.id into v_ingredient_id
        from public.ingredients i
        where i.user_id = v_import.user_id
          and public.normalize_receipt_name(i.name) = v_normalized
        order by i.name
        limit 1;
        if found then
          v_match_status := 'matched';
          v_confidence := 0.95;
          v_suggested_ingredient_id := null;
          v_suggested_name := null;
          v_suggestion_confidence := null;
          v_suggestion_reason := null;
          v_suggestion_source := null;
        elsif v_suggested_ingredient_id is not null or v_suggested_name is not null then
          -- Every AI candidate remains a review-only suggestion. Confidence
          -- never upgrades it to a confirmed nutrition match.
          v_match_status := 'possible_match';
          v_confidence := v_suggestion_confidence;
          v_suggestion_source := coalesce(v_suggestion_source, 'openai');
        else
          select i.id, i.name into v_suggested_ingredient_id, v_suggested_name
          from public.ingredients i
          where i.user_id = v_import.user_id
            and (public.normalize_receipt_name(i.name) like '%' || v_normalized || '%'
                 or v_normalized like '%' || public.normalize_receipt_name(i.name) || '%')
          order by length(i.name), i.name
          limit 1;
          if found then
            v_match_status := 'possible_match';
            v_confidence := 0.5;
            v_suggestion_confidence := 0.5;
            v_suggestion_reason := '名称相似，需要确认';
            v_suggestion_source := 'name_similarity';
          end if;
        end if;
      end if;
    end if;

    insert into public.receipt_items (
      receipt_import_id, position, raw_line, raw_name, raw_quantity, raw_unit, raw_price,
      ingredient_id, suggested_ingredient_id, suggested_name, suggestion_confidence,
      suggestion_reason, suggestion_source, match_status, match_confidence,
      confirmed_name, confirmed_quantity, confirmed_unit
    ) values (
      v_import.id, v_position, nullif(btrim(v_item ->> 'line'), ''), v_raw_name,
      v_raw_quantity, v_raw_unit, v_raw_price, v_ingredient_id, v_suggested_ingredient_id,
      v_suggested_name, v_suggestion_confidence, v_suggestion_reason, v_suggestion_source,
      v_match_status, v_confidence, v_raw_name, v_confirmed_quantity, v_confirmed_unit
    );
    v_position := v_position + 1;
  end loop;

  update public.receipt_imports
  set status = 'ready_for_review', recognition_provider = btrim(p_provider), raw_text = p_raw_text,
      error_code = null, error_message = null, updated_at = now()
  where id = v_import.id;
  return jsonb_build_object('receiptImportId', v_import.id, 'status', 'ready_for_review', 'itemCount', v_position);
end;
$$;

revoke all on function public.claim_receipt_ai_match_call(uuid, text, integer, text, text) from public, anon;
revoke all on function public.complete_receipt_ai_match_call(uuid, text, jsonb, text, integer, integer)
  from public, anon, authenticated;
revoke all on function public.get_receipt_import(uuid) from public, anon;
revoke all on function public.apply_receipt_recognition(uuid, text, jsonb, text) from public, anon, authenticated;

grant execute on function public.claim_receipt_ai_match_call(uuid, text, integer, text, text) to authenticated;
grant execute on function public.complete_receipt_ai_match_call(uuid, text, jsonb, text, integer, integer) to service_role;
grant execute on function public.get_receipt_import(uuid) to authenticated;
grant execute on function public.apply_receipt_recognition(uuid, text, jsonb, text) to service_role;
