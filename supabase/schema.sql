-- Run this migration in the SQL editor of a Supabase project.
begin;

create sequence if not exists public.fitness_change_seq as bigint;
create table if not exists public.fitness_rows (
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null,
  id text not null check (id ~ '^[A-Za-z0-9_-]{1,80}$'),
  payload jsonb check (payload is null or (jsonb_typeof(payload) = 'object' and pg_column_size(payload) <= 30000)),
  revision integer not null check (revision > 0),
  change_id bigint not null,
  last_mutation text not null,
  primary key (user_id, kind, id)
);
-- Extend the record contract in place so existing clients can still read and edit summaries.
alter table public.fitness_rows drop constraint if exists fitness_rows_kind_check;
alter table public.fitness_rows add constraint fitness_rows_kind_check
  check (kind in ('profile','food','food_day','workout','weight','activity','food_preset','workout_preset','strength_exercise'));
create index if not exists fitness_rows_user_cursor on public.fitness_rows (user_id, change_id);
alter table public.fitness_rows enable row level security;
revoke all on table public.fitness_rows from public, anon, authenticated;
revoke all on sequence public.fitness_change_seq from public, anon, authenticated;
grant select on table public.fitness_rows to authenticated;
drop policy if exists fitness_read_own on public.fitness_rows;
create policy fitness_read_own on public.fitness_rows for select to authenticated
  using ((select auth.uid()) = user_id);

-- Validate the shared exercise identity and its load convention before accepting sets or favorites.
create schema if not exists cut_log_private;
revoke all on schema cut_log_private from public, anon, authenticated;
create or replace function cut_log_private.valid_strength_definition(move jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare
  bar jsonb := move->'bar';
begin
  if jsonb_typeof(move) is distinct from 'object'
    or coalesce((move->>'exerciseId') !~ '^[A-Za-z0-9_-]{1,80}$', true)
    or jsonb_typeof(move->'name') is distinct from 'string'
    or length(btrim(move->>'name')) not between 1 and 70
    or jsonb_typeof(move->'variant') is distinct from 'string'
    or length(move->>'variant') > 70
    or coalesce((move->>'muscle') not in ('chest','back','shoulders','legs','arms','core'), true)
    or coalesce((move->>'mode') not in ('dumbbell','barbell','plates','machine','bodyweight','assisted','other','unknown'), true)
    or ((move ? 'dumbbells') and coalesce((move->>'dumbbells') not in ('1','2'), true))
  then return false; end if;
  if bar is null or bar = 'null'::jsonb then return true; end if;
  if jsonb_typeof(bar) <> 'object' or jsonb_typeof(bar->'weight') is distinct from 'number'
    or coalesce((bar->>'unit') not in ('lb','kg'), true)
  then return false; end if;
  return (bar->>'weight')::numeric between 0 and 2500;
end
$$;
revoke all on function cut_log_private.valid_strength_definition(jsonb) from public, anon, authenticated;

-- Server revision guards writes and tombstones. Per-account serialization orders the change cursor.
create or replace function public.write_fitness_row(
  p_kind text, p_id text, p_payload jsonb, p_expected integer, p_mutation text
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  owner_id uuid := auth.uid();
  found_row public.fitness_rows%rowtype;
  detail jsonb;
  exercise jsonb;
  training_set jsonb;
  set_count integer := 0;
  nutrient text;
begin
  if owner_id is null then raise exception 'login required' using errcode = '42501'; end if;
  if p_kind is null or p_kind not in ('profile','food','food_day','workout','weight','activity','food_preset','workout_preset','strength_exercise')
    or p_id is null or p_id !~ '^[A-Za-z0-9_-]{1,80}$'
    or p_expected is null or p_expected < 0
    or p_mutation is null or p_mutation !~ '^[A-Za-z0-9_-]{16,80}$'
    or (p_payload is not null and (jsonb_typeof(p_payload) <> 'object' or pg_column_size(p_payload) > 30000))
  then raise exception 'invalid record' using errcode = '22023'; end if;
  if (p_kind = 'profile' and p_id <> 'personal')
    or (p_kind in ('weight','activity','food_day') and (p_id !~ '^\d{4}-\d{2}-\d{2}$'
      or (p_payload is not null and (p_payload->>'day') is distinct from p_id)))
    or (p_kind in ('food','workout') and p_payload is not null
      and coalesce(p_payload->>'day', '') !~ '^\d{4}-\d{2}-\d{2}$')
  then raise exception 'invalid day or record id' using errcode = '22023'; end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(owner_id::text, 4173));
  select * into found_row from public.fitness_rows where user_id = owner_id and kind = p_kind and id = p_id;
  if found_row.last_mutation = p_mutation then
    return jsonb_build_object('applied', true, 'row', to_jsonb(found_row));
  end if;
  if coalesce(found_row.revision, 0) <> p_expected then
    return jsonb_build_object('applied', false, 'row', case when found_row.id is null then null else to_jsonb(found_row) end);
  end if;

  -- Old clients send no detailed field. Keep it when they update a session or preset.
  if p_kind in ('workout','workout_preset') and p_payload is not null then
    detail := p_payload->'strengthDetails';
    if detail is null and found_row.payload ? 'strengthDetails' then
      p_payload := jsonb_set(p_payload, '{strengthDetails}', found_row.payload->'strengthDetails');
    elsif detail is not null then
      if jsonb_typeof(detail) <> 'array' then raise exception 'invalid strength detail' using errcode = '22023'; end if;
      if jsonb_array_length(detail) > 25
        or (jsonb_array_length(detail) > 0 and (p_payload->>'kind') is distinct from 'strength')
      then raise exception 'invalid strength detail' using errcode = '22023'; end if;
      for exercise in select value from jsonb_array_elements(detail) loop
        if not cut_log_private.valid_strength_definition(exercise)
          or jsonb_typeof(exercise->'sets') is distinct from 'array'
        then raise exception 'invalid exercise' using errcode = '22023'; end if;
        if jsonb_array_length(exercise->'sets') not between 1 and 60 then
          raise exception 'invalid set count' using errcode = '22023';
        end if;
        set_count := set_count + jsonb_array_length(exercise->'sets');
        for training_set in select value from jsonb_array_elements(exercise->'sets') loop
          if jsonb_typeof(training_set) is distinct from 'object'
            or coalesce(jsonb_typeof(training_set->'weight') not in ('number','null'), true)
            or jsonb_typeof(training_set->'reps') is distinct from 'number'
            or coalesce((training_set->>'reps') !~ '^[0-9]{1,3}$', true)
            or coalesce((training_set->>'unit') not in ('lb','kg'), true)
            or (training_set ? 'warmup' and jsonb_typeof(training_set->'warmup') <> 'boolean')
            or (training_set ? 'note' and (jsonb_typeof(training_set->'note') <> 'string' or length(training_set->>'note') > 120))
            or (exercise->>'mode' = 'bodyweight' and training_set->>'weight' is not null)
          then raise exception 'invalid set' using errcode = '22023'; end if;
          if (training_set->>'reps')::integer not between 1 and 300
            or (training_set->>'weight')::numeric not between 0 and 2500
          then raise exception 'invalid set' using errcode = '22023'; end if;
        end loop;
      end loop;
      if set_count > 180 then raise exception 'too many sets' using errcode = '22023'; end if;
    end if;
  end if;
  if p_kind = 'strength_exercise' and p_payload is not null and (
    not cut_log_private.valid_strength_definition(p_payload)
    or (p_payload->>'exerciseId') is distinct from p_id
    or coalesce((p_payload->>'unit') not in ('lb','kg'), true)
  ) then raise exception 'invalid saved exercise' using errcode = '22023'; end if;
  if p_kind = 'food_day' and p_payload is not null then
    if p_id::date > (now() at time zone 'America/Los_Angeles')::date
      or jsonb_typeof(p_payload->'target') is distinct from 'object'
    then raise exception 'invalid food day' using errcode = '22023'; end if;
    foreach nutrient in array array['kcal','protein','carbs','fat'] loop
      if jsonb_typeof(p_payload->'target'->nutrient) is distinct from 'number'
        or (p_payload->'target'->>nutrient)::numeric not between 0 and 8000
      then raise exception 'invalid saved target' using errcode = '22023'; end if;
    end loop;
  end if;

  insert into public.fitness_rows (user_id, kind, id, payload, revision, change_id, last_mutation)
  values (owner_id, p_kind, p_id, p_payload, p_expected + 1,
          pg_catalog.nextval('public.fitness_change_seq'::regclass), p_mutation)
  on conflict (user_id, kind, id) do update set payload = excluded.payload, revision = excluded.revision,
    change_id = excluded.change_id, last_mutation = excluded.last_mutation
  returning * into found_row;
  return jsonb_build_object('applied', true, 'row', to_jsonb(found_row));
end
$$;
revoke all on function public.write_fitness_row(text,text,jsonb,integer,text) from public, anon, authenticated;
grant execute on function public.write_fitness_row(text,text,jsonb,integer,text) to authenticated;

-- Keep at most one hourly counter per user and upstream provider.
create table if not exists public.fitness_api_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('ai','usda')),
  hour timestamptz not null,
  requests integer not null,
  primary key (user_id, provider)
);
alter table public.fitness_api_usage enable row level security;
revoke all on table public.fitness_api_usage from public, anon, authenticated;

create or replace function public.use_fitness_provider(p_provider text) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  owner_id uuid := auth.uid();
  bucket timestamptz := date_trunc('hour', now(), 'UTC');
  allowance integer;
  used integer;
begin
  if owner_id is null then raise exception 'login required' using errcode = '42501'; end if;
  allowance := case p_provider when 'ai' then 40 when 'usda' then 90 else 0 end;
  if allowance = 0 then return false; end if;
  insert into public.fitness_api_usage as usage (user_id, provider, hour, requests)
    values (owner_id, p_provider, bucket, 1)
  on conflict (user_id, provider) do update
    set hour = excluded.hour, requests = case when usage.hour = excluded.hour then usage.requests + 1 else 1 end
    where usage.hour <> excluded.hour or usage.requests < allowance
  returning requests into used;
  return used is not null;
end
$$;
revoke all on function public.use_fitness_provider(text) from public, anon, authenticated;
grant execute on function public.use_fitness_provider(text) to authenticated;

commit;
