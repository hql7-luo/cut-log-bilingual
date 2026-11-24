-- Optional migration. Run schema.sql first. Provision a dedicated token per connector.
begin;
create schema if not exists cut_log_private;
revoke all on schema cut_log_private from public, anon, authenticated;

create table if not exists cut_log_private.agent_keys (
  token_hash text primary key check (token_hash ~ '^[a-f0-9]{64}$'),
  user_id uuid not null references auth.users(id) on delete cascade,
  label text not null,
  expires_at timestamptz,
  revoked_at timestamptz,
  hour timestamptz,
  requests integer not null default 0
);
alter table cut_log_private.agent_keys add column if not exists can_log_workouts boolean not null default false;

create table if not exists cut_log_private.agent_requests (
  user_id uuid not null references auth.users(id) on delete cascade,
  idem_key text not null,
  fingerprint text not null,
  meal_fingerprint text,
  response jsonb not null,
  created_at timestamptz not null default now(),
  primary key (user_id, idem_key)
);
create index if not exists fitness_agent_recent_meal
  on cut_log_private.agent_requests(user_id, meal_fingerprint, created_at desc);
create table if not exists cut_log_private.agent_previews (
  user_id uuid not null references auth.users(id) on delete cascade,
  token_hash text not null references cut_log_private.agent_keys(token_hash) on delete cascade,
  idem_key text not null,
  fingerprint text not null,
  expires_at timestamptz not null,
  primary key (token_hash, idem_key)
);
alter table cut_log_private.agent_keys enable row level security;
alter table cut_log_private.agent_requests enable row level security;
alter table cut_log_private.agent_previews enable row level security;
revoke all on all tables in schema cut_log_private from public, anon, authenticated;
create index if not exists fitness_agent_food_day on public.fitness_rows (user_id, (payload->>'day'), id)
  where kind = 'food' and payload is not null;

-- Construct a valid native food row from connector quantities. Nutrition is supplied by the connector or the user.
create or replace function cut_log_private.agent_food(
  item jsonb, food_day text, food_meal text, food_time bigint
) returns jsonb language plpgsql immutable set search_path = '' as $$
declare
  name text := btrim(item->>'name');
  unit text := btrim(item->>'unit');
  src text := coalesce(item->>'source', 'estimate');
  amount numeric;
  grams numeric;
  values_json jsonb;
  bounds_json jsonb;
  field text;
  value numeric;
  low_value numeric;
  high_value numeric;
begin
  if jsonb_typeof(item) is distinct from 'object' or name is null or length(name) not between 1 and 140
    or unit is null or length(unit) not between 1 and 16 or src not in ('estimate','label','manual')
    or jsonb_typeof(item->'amount') is distinct from 'number' then return null; end if;
  amount := (item->>'amount')::numeric;
  if amount <= 0 or amount > 10000 then return null; end if;
  if item->>'grams' is not null then
    if jsonb_typeof(item->'grams') is distinct from 'number' then return null; end if;
    grams := (item->>'grams')::numeric;
    if grams <= 0 or grams > 20000 then return null; end if;
  elsif unit = 'g' then grams := amount;
  end if;
  if unit = 'g' and grams is distinct from amount then return null; end if;

  foreach field in array array['kcal','protein_g','carbs_g','fat_g'] loop
    if jsonb_typeof(item->field) is distinct from 'number' then return null; end if;
    value := (item->>field)::numeric;
    if value < 0 or value > (case when field = 'kcal' then 20000 else 3000 end) then return null; end if;
    if item->>'range' is not null then
      if src <> 'estimate'
        or jsonb_typeof(item->'range'->'low'->field) is distinct from 'number'
        or jsonb_typeof(item->'range'->'high'->field) is distinct from 'number' then return null; end if;
      low_value := (item->'range'->'low'->>field)::numeric;
      high_value := (item->'range'->'high'->>field)::numeric;
      if low_value < 0 or low_value > value or high_value < value or high_value > (case when field = 'kcal' then 20000 else 3000 end)
      then return null; end if;
    end if;
  end loop;

  values_json := jsonb_build_object('kcal', item->'kcal', 'protein', item->'protein_g', 'carbs', item->'carbs_g', 'fat', item->'fat_g');
  if item->>'range' is not null then
    select jsonb_object_agg(
      side, jsonb_build_object('kcal', val->'kcal', 'protein', val->'protein_g', 'carbs', val->'carbs_g', 'fat', val->'fat_g')
    ) into bounds_json from jsonb_each(item->'range') as v(side, val) where side in ('low','high');
  end if;
  return jsonb_build_object(
    'name', name, 'amount', amount, 'unit', unit, 'grams', grams, 'estimatedPortion', src = 'estimate',
    'note', left(coalesce(item->>'note',''), 350), 'lookup', '', 'day', food_day, 'meal', food_meal, 'time', food_time,
    'spec', jsonb_strip_nulls(jsonb_build_object(
      'name', name, 'aliases', '[]'::jsonb, 'category', '其他', 'source', src, 'base', values_json,
      'defaultUnit', unit, 'defaultAmount', amount,
      'portions', case when grams is null then '{}'::jsonb else jsonb_build_object(unit, grams / amount) end,
      'bounds', bounds_json, 'note', '通过已授权的饮食 API 导入。'
    )) || jsonb_build_object('basisGrams', grams)
  );
end
$$;

-- Build the native workout payload from a spoken summary, without inventing exercises.
create or replace function cut_log_private.agent_workout(
  document jsonb, workout_day text, workout_time bigint
) returns jsonb language plpgsql immutable set search_path = '' as $$
declare
  workout_kind text := document->>'kind';
  workout_note text := btrim(coalesce(document->>'note', ''));
  muscle_groups jsonb := coalesce(nullif(document->'muscles', 'null'::jsonb), '[]'::jsonb);
  exercises jsonb := coalesce(nullif(document->'exercises', 'null'::jsonb), '[]'::jsonb);
  checked_exercises jsonb := '[]'::jsonb;
  exercise jsonb;
  exercise_name text;
  weight numeric;
  sets numeric;
  reps numeric;
  minutes numeric;
begin
  if workout_kind is null or workout_kind not in ('strength','basketball','incline','treadmill','other')
    or (document->>'note' is not null and jsonb_typeof(document->'note') <> 'string')
    or length(workout_note) > 500 or workout_note ~ '[[:cntrl:]]'
    or jsonb_typeof(muscle_groups) <> 'array' or jsonb_typeof(exercises) <> 'array'
  then return null; end if;
  if jsonb_array_length(muscle_groups) > 6 or jsonb_array_length(exercises) > 30
    or ((workout_kind = 'strength') is distinct from (muscle_groups <> '[]'::jsonb or exercises <> '[]'::jsonb))
    or exists (
      select 1 from jsonb_array_elements(muscle_groups) as group_entry(value)
      where jsonb_typeof(value) <> 'string' or value #>> '{}' not in ('chest','back','shoulders','legs','arms','core')
    )
  then return null; end if;

  if document->>'minutes' is not null then
    if jsonb_typeof(document->'minutes') <> 'number' then return null; end if;
    minutes := (document->>'minutes')::numeric;
    if minutes < 1 or minutes > 600 or minutes <> trunc(minutes) then return null; end if;
  end if;
  for exercise in select value from jsonb_array_elements(exercises) loop
    exercise_name := btrim(exercise->>'name');
    if jsonb_typeof(exercise) <> 'object' or jsonb_typeof(exercise->'name') is distinct from 'string'
      or length(exercise_name) not between 1 and 70 or exercise_name ~ '[[:cntrl:]]'
      or coalesce(exercise->>'unit','') not in ('lb','kg')
      or coalesce(exercise->>'muscle','') not in ('chest','back','shoulders','legs','arms','core')
      or jsonb_typeof(exercise->'weight') is distinct from 'number'
      or jsonb_typeof(exercise->'sets') is distinct from 'number'
      or jsonb_typeof(exercise->'reps') is distinct from 'number'
    then return null; end if;
    weight := (exercise->>'weight')::numeric;
    sets := (exercise->>'sets')::numeric;
    reps := (exercise->>'reps')::numeric;
    if weight < 0 or weight > 2500 or sets < 1 or sets > 100 or sets <> trunc(sets)
      or reps < 1 or reps > 300 or reps <> trunc(reps)
    then return null; end if;
    checked_exercises := checked_exercises || jsonb_build_array(jsonb_build_object(
      'name', exercise_name, 'muscle', exercise->>'muscle', 'weight', weight,
      'unit', exercise->>'unit', 'sets', sets, 'reps', reps
    ));
  end loop;
  return jsonb_build_object('day', workout_day, 'time', workout_time, 'kind', workout_kind,
    'muscles', muscle_groups, 'exercises', checked_exercises, 'minutes', minutes, 'note', workout_note);
end
$$;
revoke all on function cut_log_private.agent_workout(jsonb,text,bigint) from public, anon, authenticated;

-- This is the only anonymous RPC for agent records. The caller needs a 256-bit token.
create or replace function public.fitness_agent_request(
  p_token text, p_action text, p_document jsonb, p_key text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
<<request_state>>
declare
  digest text;
  owner_id uuid;
  bucket timestamptz := date_trunc('hour', now(), 'UTC');
  workout_allowed boolean;
  current_day text := to_char(now() at time zone 'America/Los_Angeles', 'YYYY-MM-DD');
  food_day text;
  food_meal text;
  record_id text;
  fingerprint text;
  meal_fingerprint text;
  existing cut_log_private.agent_requests%rowtype;
  current_row public.fitness_rows%rowtype;
  result jsonb;
  item jsonb;
  payload jsonb;
  items jsonb := '[]'::jsonb;
  built jsonb := '[]'::jsonb;
  pace bigint := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;
  page_limit integer;
  after_id text;
  source_type text;
begin
  if p_token is null or p_token !~ '^cut_[A-Za-z0-9_-]{43}$' then
    return jsonb_build_object('status',401,'error','invalid_token');
  end if;
  digest := encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
  update cut_log_private.agent_keys as k
    set hour = bucket, requests = case when k.hour = bucket then k.requests + 1 else 1 end
    where k.token_hash = digest and k.revoked_at is null and (k.expires_at is null or k.expires_at > now())
      and (k.hour is distinct from bucket or k.requests < 160)
    returning k.user_id, k.can_log_workouts into owner_id, workout_allowed;
  if owner_id is null then
    if exists (select 1 from cut_log_private.agent_keys as k where k.token_hash = digest and k.revoked_at is null
      and (k.expires_at is null or k.expires_at > now())) then
      return jsonb_build_object('status',429,'error','rate_limit_exceeded');
    end if;
    return jsonb_build_object('status',401,'error','invalid_token');
  end if;
  if jsonb_typeof(p_document) is distinct from 'object' or pg_column_size(p_document) > 40000
    or p_action is null or p_action not in ('list','get','preview','create','update','delete','create_workout') then
    return jsonb_build_object('status',400,'error','invalid_request');
  end if;
  if p_action = 'create_workout' and not workout_allowed then
    return jsonb_build_object('status',403,'error','workout_scope_required');
  end if;

  food_day := coalesce(p_document->>'date', current_day);
  food_meal := p_document->>'meal';
  record_id := p_document->>'id';
  if food_day !~ '^\d{4}-\d{2}-\d{2}$' or food_day > current_day
    or (food_meal is not null and food_meal not in ('breakfast','lunch','dinner','snack')) then
    return jsonb_build_object('status',400,'error','invalid_date_or_meal');
  end if;
  begin
    if to_char(food_day::date, 'YYYY-MM-DD') <> food_day then return jsonb_build_object('status',400,'error','invalid_date'); end if;
  exception when datetime_field_overflow or invalid_datetime_format then
    return jsonb_build_object('status',400,'error','invalid_date');
  end;
  if p_action = 'list' then
    if p_document->>'limit' is not null and (p_document->>'limit') !~ '^\d{1,3}$' then
      return jsonb_build_object('status',400,'error','invalid_limit');
    end if;
    page_limit := least(100, greatest(1, coalesce((p_document->>'limit')::int, 50)));
    after_id := coalesce(p_document->>'after', '');
    select coalesce(jsonb_agg(to_jsonb(entry) order by entry.id), '[]'::jsonb) into items
      from (select f.id,f.revision,f.payload from public.fitness_rows as f
      where f.user_id = owner_id and f.kind = 'food' and f.payload->>'day' = food_day and f.id > after_id
      order by f.id limit page_limit + 1) as entry;
    return jsonb_build_object('status',200,'rows',items - page_limit,
      'next_cursor', case when jsonb_array_length(items) > page_limit then items->(page_limit-1)->>'id' else null end);
  end if;

  if p_action in ('get','update','delete') and (record_id is null or record_id !~ '^[A-Za-z0-9_-]{1,80}$') then
    return jsonb_build_object('status',400,'error','invalid_id');
  end if;
  if p_action = 'get' then
    select f.* into current_row from public.fitness_rows as f
      where f.user_id = owner_id and f.kind = 'food' and f.id = record_id and f.payload is not null;
    if current_row.id is null then return jsonb_build_object('status',404,'error','record_not_found'); end if;
    return jsonb_build_object('status',200,'rows',jsonb_build_array(to_jsonb(current_row)));
  end if;
  if p_key is null or p_key !~ '^[A-Za-z0-9_-]{16,128}$' then
    return jsonb_build_object('status',400,'error','idempotency_key_required');
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(owner_id::text, 4173));

  if p_action in ('preview','create') then
    source_type := coalesce(p_document->>'input_type','text');
    if food_meal is null or source_type not in ('text','photo') or jsonb_typeof(p_document->'items') is distinct from 'array' then
      return jsonb_build_object('status',400,'error','invalid_meal_or_items');
    end if;
    if jsonb_array_length(p_document->'items') not between 1 and 24 then
      return jsonb_build_object('status',400,'error','invalid_item_count');
    end if;
    for item in select value from jsonb_array_elements(p_document->'items') loop
      payload := cut_log_private.agent_food(item, food_day, food_meal, pace + jsonb_array_length(built));
      if payload is null or (source_type = 'photo' and payload->'spec'->>'source' <> 'estimate') then
        return jsonb_build_object('status',400,'error','invalid_food_or_photo_source');
      end if;
      built := built || jsonb_build_array(payload);
    end loop;
  end if;
  if p_action = 'create_workout' then
    payload := cut_log_private.agent_workout(p_document, food_day, pace);
    if payload is null then return jsonb_build_object('status',400,'error','invalid_workout'); end if;
  end if;

  -- The same key is only reusable for the same normalized operation.
  fingerprint := encode(sha256(convert_to(
    (case when p_action = 'preview' then 'create' else p_action end) ||
    ((p_document - 'confirmed' - 'preview' - 'allow_duplicate') ||
      case when p_action in ('preview','create','create_workout') then jsonb_build_object('date', food_day) else '{}'::jsonb end)::text,
    'UTF8')), 'hex');
  select * into existing from cut_log_private.agent_requests as r where r.user_id = owner_id and r.idem_key = p_key;
  if existing.idem_key is not null then
    if existing.fingerprint <> fingerprint then return jsonb_build_object('status',409,'error','idempotency_key_reused'); end if;
    return existing.response || jsonb_build_object('status',200,'replayed',true);
  end if;

  if p_action = 'preview' then
    delete from cut_log_private.agent_previews where token_hash = digest and expires_at <= now();
    insert into cut_log_private.agent_previews(user_id, token_hash, idem_key, fingerprint, expires_at)
      values(owner_id,digest,p_key,fingerprint,now() + interval '20 minutes')
    on conflict (token_hash,idem_key) do update set fingerprint = excluded.fingerprint, expires_at = excluded.expires_at;
    return jsonb_build_object('status',200,'preview',true,'rows',(select jsonb_agg(jsonb_build_object('payload', b))
      from jsonb_array_elements(built) as x(b)));
  end if;

  if p_action = 'create_workout' then
    insert into public.fitness_rows(user_id,kind,id,payload,revision,change_id,last_mutation)
      values(owner_id,'workout',gen_random_uuid()::text,payload,1,
        nextval('public.fitness_change_seq'::regclass),p_key) returning * into current_row;
    result := jsonb_build_object('status',201,'id',current_row.id,'date',food_day,'kind',payload->>'kind');
  elsif p_action = 'create' then
    if source_type = 'photo' and (
      (p_document->'confirmed') is distinct from 'true'::jsonb or not exists (
        select 1 from cut_log_private.agent_previews where token_hash = digest and idem_key = p_key
          and request_state.fingerprint = agent_previews.fingerprint and expires_at > now()
      )) then return jsonb_build_object('status',409,'error','photo_confirmation_required'); end if;

    -- A second key cannot silently record an identical meal a few seconds later.
    select encode(sha256(convert_to(food_day || food_meal || jsonb_agg(signature order by signature::text)::text,'UTF8')), 'hex')
    into meal_fingerprint
    from (select jsonb_build_array(lower(b->>'name'),b->'amount',b->'unit',b->'grams',b->'spec'->'base') as signature
      from jsonb_array_elements(built) as x(b)) as normalized;
    if (p_document->'allow_duplicate') is distinct from 'true'::jsonb and exists (
      select 1 from cut_log_private.agent_requests as r where r.user_id = owner_id
        and r.meal_fingerprint = request_state.meal_fingerprint and r.created_at > now() - interval '10 minutes'
    ) then return jsonb_build_object('status',409,'error','duplicate_meal'); end if;

    for payload in select value from jsonb_array_elements(built) loop
      insert into public.fitness_rows(user_id,kind,id,payload,revision,change_id,last_mutation)
        values(owner_id,'food',gen_random_uuid()::text,payload,1,
          nextval('public.fitness_change_seq'::regclass),p_key) returning * into current_row;
      items := items || jsonb_build_array(to_jsonb(current_row));
    end loop;
    result := jsonb_build_object('status',201,'rows',items);
    delete from cut_log_private.agent_previews where token_hash = digest and idem_key = p_key;
  else
    select * into current_row from public.fitness_rows
      where user_id = owner_id and kind = 'food' and id = record_id and fitness_rows.payload is not null;
    if current_row.id is null then return jsonb_build_object('status',404,'error','record_not_found'); end if;
    if jsonb_typeof(p_document->'revision') is distinct from 'number' or (p_document->>'revision')::numeric <> current_row.revision then
      return jsonb_build_object('status',409,'error','revision_conflict','current_revision',current_row.revision);
    end if;
    payload := null;
    if p_action = 'update' then
      payload := cut_log_private.agent_food(p_document->'item',coalesce(p_document->>'date',current_row.payload->>'day'),
        coalesce(food_meal,current_row.payload->>'meal'),(current_row.payload->>'time')::bigint);
      if payload is null then return jsonb_build_object('status',400,'error','invalid_item'); end if;
    end if;
    update public.fitness_rows as f set payload = request_state.payload, revision = f.revision + 1,
      change_id = nextval('public.fitness_change_seq'::regclass), last_mutation = p_key
      where f.user_id = owner_id and f.kind = 'food' and f.id = record_id returning f.* into current_row;
    result := case when p_action = 'delete' then jsonb_build_object('status',200,'deleted',record_id,'revision',current_row.revision)
      else jsonb_build_object('status',200,'rows',jsonb_build_array(to_jsonb(current_row))) end;
  end if;
  insert into cut_log_private.agent_requests as r (user_id,idem_key,fingerprint,meal_fingerprint,response)
    values(owner_id,p_key,fingerprint,meal_fingerprint,result);
  return result;
end
$$;

revoke all on function public.fitness_agent_request(text,text,jsonb,text) from public, anon, authenticated;
grant execute on function public.fitness_agent_request(text,text,jsonb,text) to anon;
commit;
