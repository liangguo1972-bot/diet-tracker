-- FR-001: photo receipt import. A receipt first creates a private review draft;
-- inventory is changed only by confirm_receipt_import.

create table public.receipt_imports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  storage_path text not null,
  source_type text not null default 'photo' check (source_type = 'photo'),
  file_name text not null check (btrim(file_name) <> ''),
  content_type text not null check (content_type in ('image/jpeg', 'image/png', 'image/webp')),
  file_size_bytes bigint not null check (file_size_bytes > 0 and file_size_bytes <= 10485760),
  file_hash text,
  status text not null default 'uploaded' check (status in ('uploaded', 'processing', 'ready_for_review', 'confirmed', 'failed', 'cancelled')),
  recognition_provider text,
  merchant_name text,
  purchased_on date,
  raw_text text,
  error_code text,
  error_message text,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, storage_path)
);

create unique index receipt_imports_user_file_hash_active_idx
  on public.receipt_imports (user_id, file_hash)
  where file_hash is not null and status <> 'cancelled';

create table public.receipt_items (
  id uuid primary key default gen_random_uuid(),
  receipt_import_id uuid not null references public.receipt_imports(id) on delete cascade,
  position integer not null check (position >= 0),
  raw_line text,
  raw_name text not null check (btrim(raw_name) <> ''),
  raw_quantity numeric,
  raw_unit text,
  raw_price numeric,
  ingredient_id uuid references public.ingredients(id) on delete restrict,
  match_status text not null default 'unmatched' check (match_status in ('matched', 'possible_match', 'unmatched', 'ignored')),
  match_confidence numeric check (match_confidence is null or (match_confidence >= 0 and match_confidence <= 1)),
  confirmed_name text,
  confirmed_quantity numeric,
  confirmed_unit text,
  storage text,
  action text not null default 'add_to_inventory' check (action in ('add_to_inventory', 'ignore')),
  inventory_id uuid references public.inventory(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (receipt_import_id, position)
);

create table public.ingredient_aliases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  ingredient_id uuid not null references public.ingredients(id) on delete cascade,
  alias text not null check (btrim(alias) <> ''),
  normalized_alias text not null check (btrim(normalized_alias) <> ''),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, normalized_alias)
);

alter table public.inventory
  add column receipt_item_id uuid references public.receipt_items(id) on delete restrict;

create unique index inventory_receipt_item_unique_idx
  on public.inventory (receipt_item_id)
  where receipt_item_id is not null;

create index receipt_imports_user_created_idx on public.receipt_imports (user_id, created_at desc);
create index receipt_items_import_position_idx on public.receipt_items (receipt_import_id, position);
create index ingredient_aliases_user_normalized_idx on public.ingredient_aliases (user_id, normalized_alias);

alter table public.receipt_imports enable row level security;
alter table public.receipt_items enable row level security;
alter table public.ingredient_aliases enable row level security;

create policy receipt_imports_select on public.receipt_imports
for select to authenticated using (user_id = (select auth.uid()));

create policy receipt_items_select on public.receipt_items
for select to authenticated using (
  exists (
    select 1 from public.receipt_imports ri
    where ri.id = receipt_import_id and ri.user_id = (select auth.uid())
  )
);

create policy ingredient_aliases_select on public.ingredient_aliases
for select to authenticated using (user_id = (select auth.uid()));

revoke all on public.receipt_imports, public.receipt_items, public.ingredient_aliases from anon, authenticated;
grant select on public.receipt_imports, public.receipt_items, public.ingredient_aliases to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'receipt-source', 'receipt-source', false, 10485760,
  array['image/jpeg', 'image/png', 'image/webp']::text[]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy receipt_source_insert on storage.objects
for insert to authenticated with check (
  bucket_id = 'receipt-source'
  and exists (
    select 1
    from public.receipt_imports ri
    where ri.user_id = (select auth.uid())
      and ri.storage_path = name
  )
);

create policy receipt_source_select on storage.objects
for select to authenticated using (
  bucket_id = 'receipt-source'
  and exists (
    select 1
    from public.receipt_imports ri
    where ri.user_id = (select auth.uid())
      and ri.storage_path = name
  )
);

create policy receipt_source_delete on storage.objects
for delete to authenticated using (
  bucket_id = 'receipt-source'
  and exists (
    select 1
    from public.receipt_imports ri
    where ri.user_id = (select auth.uid())
      and ri.storage_path = name
      and ri.status in ('uploaded', 'failed', 'cancelled')
  )
);

create or replace function public.normalize_receipt_name(p_name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(regexp_replace(lower(btrim(coalesce(p_name, ''))), '[^[:alnum:]\u4e00-\u9fff]+', '', 'g'), '')
$$;

create or replace function public.create_receipt_import(
  p_file_name text,
  p_content_type text,
  p_file_size_bytes bigint,
  p_file_hash text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_import_id uuid := gen_random_uuid();
  v_extension text;
  v_existing public.receipt_imports%rowtype;
  v_path text;
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;
  if nullif(btrim(p_file_name), '') is null
     or p_content_type not in ('image/jpeg', 'image/png', 'image/webp')
     or p_file_size_bytes is null or p_file_size_bytes <= 0 or p_file_size_bytes > 10485760
  then
    raise exception 'RECEIPT_FILE_INVALID' using errcode = '22023';
  end if;
  if p_file_hash is not null and p_file_hash !~ '^[A-Fa-f0-9]{32,128}$' then
    raise exception 'RECEIPT_FILE_INVALID' using errcode = '22023';
  end if;

  if p_file_hash is not null then
    select * into v_existing
    from public.receipt_imports
    where user_id = v_user_id and file_hash = lower(p_file_hash) and status <> 'cancelled'
    order by created_at desc
    limit 1;
    if found then
      return jsonb_build_object(
        'receiptImportId', v_existing.id,
        'storagePath', v_existing.storage_path,
        'status', v_existing.status,
        'reused', true
      );
    end if;
  end if;

  v_extension := case p_content_type
    when 'image/jpeg' then 'jpg'
    when 'image/png' then 'png'
    when 'image/webp' then 'webp'
  end;
  v_path := v_user_id::text || '/' || v_import_id::text || '/source.' || v_extension;

  insert into public.receipt_imports (
    id, user_id, storage_path, file_name, content_type, file_size_bytes, file_hash
  ) values (
    v_import_id, v_user_id, v_path, btrim(p_file_name), p_content_type, p_file_size_bytes,
    case when p_file_hash is null then null else lower(p_file_hash) end
  );
  return jsonb_build_object(
    'receiptImportId', v_import_id,
    'storagePath', v_path,
    'status', 'uploaded',
    'reused', false
  );
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
        where ritem.receipt_import_id = ri.id
      ), '[]'::jsonb)
    )
    from public.receipt_imports ri
    where ri.id = p_receipt_import_id and ri.user_id = v_user_id
  );
end;
$$;

create or replace function public.list_receipt_imports(p_limit integer default 20)
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
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception 'QUANTITY_INVALID' using errcode = '22023';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'receiptImportId', ri.id,
      'status', ri.status,
      'fileName', ri.file_name,
      'merchantName', ri.merchant_name,
      'purchasedOn', ri.purchased_on,
      'errorCode', ri.error_code,
      'createdAt', ri.created_at,
      'confirmedAt', ri.confirmed_at
    ) order by ri.created_at desc)
    from (
      select * from public.receipt_imports
      where user_id = v_user_id
      order by created_at desc
      limit p_limit
    ) ri
  ), '[]'::jsonb);
end;
$$;

create or replace function public.update_receipt_items(
  p_receipt_import_id uuid,
  p_items jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_import public.receipt_imports%rowtype;
  v_item jsonb;
  v_item_id uuid;
  v_ingredient_id uuid;
  v_action text;
  v_name text;
  v_quantity numeric;
  v_unit text;
  v_storage text;
  v_count integer := 0;
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;
  if p_receipt_import_id is null or p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'QUANTITY_INVALID' using errcode = '22023';
  end if;
  select * into v_import from public.receipt_imports
  where id = p_receipt_import_id and user_id = v_user_id for update;
  if not found then
    raise exception 'INVALID_REFERENCE' using errcode = 'P0001';
  end if;
  if v_import.status <> 'ready_for_review' then
    raise exception 'STATUS_CONFLICT' using errcode = 'P0001';
  end if;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    begin
      v_item_id := (v_item ->> 'receiptItemId')::uuid;
      v_ingredient_id := nullif(v_item ->> 'ingredientId', '')::uuid;
      v_action := coalesce(nullif(btrim(v_item ->> 'action'), ''), 'add_to_inventory');
      v_name := nullif(btrim(v_item ->> 'confirmedName'), '');
      v_quantity := (v_item ->> 'confirmedQuantity')::numeric;
      v_unit := nullif(btrim(v_item ->> 'confirmedUnit'), '');
      v_storage := nullif(btrim(v_item ->> 'storage'), '');
    exception when others then
      raise exception 'QUANTITY_INVALID' using errcode = '22023';
    end;
    if v_item_id is null or v_action not in ('add_to_inventory', 'ignore') then
      raise exception 'QUANTITY_INVALID' using errcode = '22023';
    end if;
    if not exists (
      select 1 from public.receipt_items where id = v_item_id and receipt_import_id = v_import.id
    ) then
      raise exception 'INVALID_REFERENCE' using errcode = 'P0001';
    end if;
    if v_action = 'add_to_inventory' then
      if v_name is null or v_quantity is null or v_quantity <= 0 or v_unit is null then
        raise exception 'QUANTITY_INVALID' using errcode = '22023';
      end if;
      if v_ingredient_id is not null and not exists (
        select 1 from public.ingredients where id = v_ingredient_id and user_id = v_user_id
      ) then
        raise exception 'INVALID_REFERENCE' using errcode = 'P0001';
      end if;
    else
      v_ingredient_id := null;
      v_name := null;
      v_quantity := null;
      v_unit := null;
      v_storage := null;
    end if;
    update public.receipt_items
    set ingredient_id = v_ingredient_id,
        match_status = case when v_action = 'ignore' then 'ignored' when v_ingredient_id is null then 'unmatched' else 'matched' end,
        match_confidence = case when v_action = 'ignore' then null when v_ingredient_id is null then null else 1 end,
        confirmed_name = v_name,
        confirmed_quantity = v_quantity,
        confirmed_unit = v_unit,
        storage = v_storage,
        action = v_action,
        updated_at = now()
    where id = v_item_id and receipt_import_id = v_import.id;
    v_count := v_count + 1;
  end loop;
  if v_count <> (select count(*) from public.receipt_items where receipt_import_id = v_import.id) then
    raise exception 'STATUS_CONFLICT' using errcode = 'P0001';
  end if;
  return public.get_receipt_import(v_import.id);
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
  v_ingredient_id uuid;
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
    exception when others then
      raise exception 'RECEIPT_RECOGNITION_INVALID' using errcode = '22023';
    end;
    if v_raw_name is null then
      raise exception 'RECEIPT_RECOGNITION_INVALID' using errcode = '22023';
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
        else
          select i.id into v_ingredient_id
          from public.ingredients i
          where i.user_id = v_import.user_id
            and (public.normalize_receipt_name(i.name) like '%' || v_normalized || '%'
                 or v_normalized like '%' || public.normalize_receipt_name(i.name) || '%')
          order by length(i.name), i.name
          limit 1;
          if found then
            v_match_status := 'possible_match';
            v_confidence := 0.5;
          end if;
        end if;
      end if;
    end if;
    insert into public.receipt_items (
      receipt_import_id, position, raw_line, raw_name, raw_quantity, raw_unit, raw_price,
      ingredient_id, match_status, match_confidence, confirmed_name, confirmed_quantity, confirmed_unit
    ) values (
      v_import.id, v_position, nullif(btrim(v_item ->> 'line'), ''), v_raw_name,
      v_raw_quantity, v_raw_unit, v_raw_price, v_ingredient_id, v_match_status, v_confidence,
      v_raw_name, v_raw_quantity, v_raw_unit
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

create or replace function public.mark_receipt_import_failed(
  p_receipt_import_id uuid,
  p_error_code text,
  p_error_message text default null
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_receipt_import_id is null or nullif(btrim(p_error_code), '') is null then
    raise exception 'RECEIPT_RECOGNITION_INVALID' using errcode = '22023';
  end if;
  update public.receipt_imports
  set status = 'failed', error_code = btrim(p_error_code), error_message = nullif(btrim(p_error_message), ''), updated_at = now()
  where id = p_receipt_import_id and status in ('uploaded', 'processing', 'failed');
  if not found then
    raise exception 'STATUS_CONFLICT' using errcode = 'P0001';
  end if;
end;
$$;

alter table public.operation_requests drop constraint operation_requests_operation_type_check;
alter table public.operation_requests add constraint operation_requests_operation_type_check
  check (operation_type in ('complete_purchase', 'save_cook_session', 'confirm_receipt_import'));

create or replace function public.get_operation_result(
  p_operation_type text,
  p_idempotency_key uuid
)
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
  if p_operation_type not in ('complete_purchase', 'save_cook_session', 'confirm_receipt_import')
     or p_idempotency_key is null then
    raise exception 'QUANTITY_INVALID' using errcode = '22023';
  end if;
  return coalesce((
    select jsonb_build_object('status', orq.status, 'response', orq.response)
    from public.operation_requests orq
    where orq.user_id = v_user_id
      and orq.operation_type = p_operation_type
      and orq.idempotency_key = p_idempotency_key
  ), 'null'::jsonb);
end;
$$;

create or replace function public.confirm_receipt_import(
  p_receipt_import_id uuid,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_import public.receipt_imports%rowtype;
  v_item public.receipt_items%rowtype;
  v_hash text;
  v_existing_hash text;
  v_existing_response jsonb;
  v_inventory_id uuid;
  v_count integer := 0;
  v_unit_kind text;
  v_grams_per_unit numeric;
  v_response jsonb;
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;
  if p_receipt_import_id is null or p_idempotency_key is null then
    raise exception 'QUANTITY_INVALID' using errcode = '22023';
  end if;
  select * into v_import from public.receipt_imports
  where id = p_receipt_import_id and user_id = v_user_id for update;
  if not found then
    raise exception 'INVALID_REFERENCE' using errcode = 'P0001';
  end if;
  if v_import.status = 'confirmed' then
    return jsonb_build_object('receiptImportId', v_import.id, 'status', 'confirmed', 'alreadyConfirmed', true);
  end if;
  if v_import.status <> 'ready_for_review' then
    raise exception 'STATUS_CONFLICT' using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from public.receipt_items
    where receipt_import_id = v_import.id and action = 'add_to_inventory'
  ) then
    raise exception 'QUANTITY_INVALID' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.receipt_items
    where receipt_import_id = v_import.id and action = 'add_to_inventory'
      and (confirmed_name is null or confirmed_quantity is null or confirmed_quantity <= 0 or confirmed_unit is null)
  ) then
    raise exception 'QUANTITY_INVALID' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.receipt_items ritem
    left join public.ingredients ing on ing.id = ritem.ingredient_id
    where ritem.receipt_import_id = v_import.id and ritem.ingredient_id is not null
      and (ing.id is null or ing.user_id <> v_user_id)
  ) then
    raise exception 'INVALID_REFERENCE' using errcode = 'P0001';
  end if;
  v_hash := md5(jsonb_build_object(
    'receiptImportId', v_import.id,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', id, 'ingredientId', ingredient_id, 'confirmedName', confirmed_name,
        'confirmedQuantity', confirmed_quantity, 'confirmedUnit', confirmed_unit,
        'storage', storage, 'action', action
      ) order by position)
      from public.receipt_items where receipt_import_id = v_import.id
    ), '[]'::jsonb)
  )::text);
  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text || ':confirm_receipt_import:' || p_idempotency_key::text, 0));
  select request_hash, response into v_existing_hash, v_existing_response
  from public.operation_requests
  where user_id = v_user_id and operation_type = 'confirm_receipt_import' and idempotency_key = p_idempotency_key;
  if found then
    if v_existing_hash <> v_hash then
      raise exception 'IDEMPOTENCY_CONFLICT' using errcode = 'P0001';
    end if;
    return v_existing_response;
  end if;
  insert into public.operation_requests (user_id, operation_type, idempotency_key, request_hash)
  values (v_user_id, 'confirm_receipt_import', p_idempotency_key, v_hash);

  for v_item in
    select * from public.receipt_items
    where receipt_import_id = v_import.id and action = 'add_to_inventory'
    order by position
  loop
    v_unit_kind := case
      when v_item.confirmed_unit = 'g' then 'weight'
      when v_item.confirmed_unit in ('个', '只', '片', '根') then 'count'
      when v_item.confirmed_unit in ('盒', '袋', '瓶', '包') then 'container'
      when v_item.confirmed_unit in ('把', '碗', '份') then 'portion'
      else 'other'
    end;
    v_grams_per_unit := case when v_item.confirmed_unit = 'g' then 1 else null end;
    insert into public.inventory (
      user_id, ingredient_id, receipt_item_id, quantity, unit, unit_kind, grams_per_unit,
      display_name, storage, purchase_date, status, receipt_raw_name, price, note
    ) values (
      v_user_id, v_item.ingredient_id, v_item.id, v_item.confirmed_quantity, v_item.confirmed_unit,
      v_unit_kind, v_grams_per_unit, v_item.confirmed_name, v_item.storage,
      coalesce(v_import.purchased_on, current_date), 'active', v_item.raw_name, v_item.raw_price,
      '小票导入 ' || v_import.id::text
    ) returning id into v_inventory_id;
    update public.receipt_items set inventory_id = v_inventory_id, updated_at = now() where id = v_item.id;
    insert into public.inventory_movements (
      user_id, inventory_id, movement_type, quantity_delta, unit, note
    ) values (
      v_user_id, v_inventory_id, 'purchase', v_item.confirmed_quantity, v_item.confirmed_unit,
      '小票导入 ' || v_import.id::text
    );
    if v_item.ingredient_id is not null then
      insert into public.ingredient_aliases (user_id, ingredient_id, alias, normalized_alias)
      values (v_user_id, v_item.ingredient_id, v_item.raw_name, public.normalize_receipt_name(v_item.raw_name))
      on conflict (user_id, normalized_alias) do update
        set ingredient_id = excluded.ingredient_id, alias = excluded.alias, updated_at = now();
    end if;
    v_count := v_count + 1;
  end loop;
  update public.receipt_imports
  set status = 'confirmed', confirmed_at = now(), error_code = null, error_message = null, updated_at = now()
  where id = v_import.id;
  v_response := jsonb_build_object(
    'receiptImportId', v_import.id, 'status', 'confirmed', 'inventoryCount', v_count, 'alreadyConfirmed', false
  );
  update public.operation_requests set response = v_response, updated_at = now()
  where user_id = v_user_id and operation_type = 'confirm_receipt_import' and idempotency_key = p_idempotency_key;
  return v_response;
end;
$$;

revoke all on function public.normalize_receipt_name(text) from public, anon, authenticated;
revoke all on function public.create_receipt_import(text, text, bigint, text) from public, anon;
revoke all on function public.get_receipt_import(uuid) from public, anon;
revoke all on function public.list_receipt_imports(integer) from public, anon;
revoke all on function public.update_receipt_items(uuid, jsonb) from public, anon;
revoke all on function public.confirm_receipt_import(uuid, uuid) from public, anon;
revoke all on function public.apply_receipt_recognition(uuid, text, jsonb, text) from public, anon, authenticated;
revoke all on function public.mark_receipt_import_failed(uuid, text, text) from public, anon, authenticated;

grant execute on function public.create_receipt_import(text, text, bigint, text) to authenticated;
grant execute on function public.get_receipt_import(uuid) to authenticated;
grant execute on function public.list_receipt_imports(integer) to authenticated;
grant execute on function public.update_receipt_items(uuid, jsonb) to authenticated;
grant execute on function public.confirm_receipt_import(uuid, uuid) to authenticated;
grant execute on function public.get_operation_result(text, uuid) to authenticated;
grant execute on function public.apply_receipt_recognition(uuid, text, jsonb, text) to service_role;
grant execute on function public.mark_receipt_import_failed(uuid, text, text) to service_role;
