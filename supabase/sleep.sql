-- Install after schema.sql and agent.sql. Existing connector keys start without sleep access.
begin;

alter table cut_log_private.agent_keys
  add column if not exists can_sync_sleep boolean not null default false,
  add column if not exists sleep_hour timestamptz,
  add column if not exists sleep_requests integer not null default 0;

create table if not exists public.daybaseline_sleep (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  start_at timestamptz not null,
  end_at timestamptz not null,
  asleep_minutes integer not null check (asleep_minutes between 1 and 1200),
  core_minutes integer check (core_minutes between 0 and 1200),
  deep_minutes integer check (deep_minutes between 0 and 1200),
  rem_minutes integer check (rem_minutes between 0 and 1200),
  awake_minutes integer check (awake_minutes between 0 and 1200),
  resting_hr numeric check (resting_hr between 1 and 300),
  hrv_ms numeric check (hrv_ms between 0.1 and 1000),
  observed_at timestamptz not null,
  primary key (user_id, day)
);

-- Older rows retain their source observation time and unknown site receipt time.
alter table public.daybaseline_sleep add column if not exists received_at timestamptz;

create table if not exists public.daybaseline_reports (
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('daily', 'weekly')),
  day date not null,
  summary text not null check (length(summary) between 1 and 3500),
  advice text not null check (length(advice) between 1 and 500),
  trend_30 text check (length(trend_30) <= 1800),
  coverage_days integer check (coverage_days between 0 and 7),
  observed_at timestamptz not null,
  primary key (user_id, kind, day)
);

alter table public.daybaseline_sleep enable row level security;
alter table public.daybaseline_reports enable row level security;
revoke all on public.daybaseline_sleep, public.daybaseline_reports from public, anon, authenticated;
grant select on public.daybaseline_sleep, public.daybaseline_reports to authenticated;
drop policy if exists daybaseline_sleep_owner on public.daybaseline_sleep;
create policy daybaseline_sleep_owner on public.daybaseline_sleep for select to authenticated
  using ((select auth.uid()) = user_id);
drop policy if exists daybaseline_reports_owner on public.daybaseline_reports;
create policy daybaseline_reports_owner on public.daybaseline_reports for select to authenticated
  using ((select auth.uid()) = user_id);

-- Require a separate scope on an existing key. Treat the database RPC as a public entry point.
create or replace function public.daybaseline_sync_sleep(p_token text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  digest text;
  owner_id uuid;
  allowed boolean;
  bucket timestamptz := date_trunc('hour', now(), 'UTC');
  pacific_today date := (now() at time zone 'America/Los_Angeles')::date;
  stamp_pattern text := '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$';
  observed timestamptz;
  start_time timestamptz;
  end_time timestamptz;
  entry_day date;
  elapsed integer;
  entry jsonb;
  core integer;
  deep integer;
  rem integer;
  awake integer;
  unstaged integer;
  asleep integer;
  known integer;
  resting numeric;
  variability numeric;
  coverage integer;
  saved_sleep integer := 0;
  saved_reports integer := 0;
  affected integer;
  seen_days date[] := array[]::date[];
  seen_reports text[] := array[]::text[];
begin
  if p_token is null or p_token !~ '^sleep_[a-f0-9]{64}$' then
    return jsonb_build_object('status', 401, 'error', 'invalid_token');
  end if;
  digest := encode(sha256(convert_to(p_token, 'UTF8')), 'hex');

  select k.user_id, k.can_sync_sleep into owner_id, allowed
    from cut_log_private.agent_keys k where k.token_hash = digest and k.revoked_at is null
      and (k.expires_at is null or k.expires_at > now()) for update;
  if owner_id is null then
    return jsonb_build_object('status', 401, 'error', 'invalid_token');
  end if;
  if not allowed then
    return jsonb_build_object('status', 403, 'error', 'sleep_scope_required');
  end if;

  update cut_log_private.agent_keys k
    set sleep_hour = bucket, sleep_requests = case when k.sleep_hour = bucket then k.sleep_requests + 1 else 1 end
    where k.token_hash = digest and (k.sleep_hour is distinct from bucket or k.sleep_requests < 24);
  if not found then
    return jsonb_build_object('status', 429, 'error', 'rate_limit_exceeded');
  end if;

  -- Validate and write one batch atomically. Older retries cannot replace a newer import.
  begin
    if jsonb_typeof(p_payload) is distinct from 'object' or pg_column_size(p_payload) > 36000
      or (p_payload - array['observed_at','nights','reports']) <> '{}'::jsonb
      or coalesce((p_payload->>'observed_at') !~ stamp_pattern, true)
      or jsonb_typeof(coalesce(p_payload->'nights', '[]')) <> 'array'
      or jsonb_typeof(coalesce(p_payload->'reports', '[]')) <> 'array' then
      raise exception using errcode = '22023';
    end if;
    observed := (p_payload->>'observed_at')::timestamptz;
    if observed > now() + interval '5 minutes' or observed < now() - interval '7 days'
      or jsonb_array_length(coalesce(p_payload->'nights', '[]')) > 31
      or jsonb_array_length(coalesce(p_payload->'reports', '[]')) > 8 then
      raise exception using errcode = '22023';
    end if;

    for entry in select value from jsonb_array_elements(coalesce(p_payload->'nights', '[]')) loop
      if jsonb_typeof(entry) <> 'object'
        or (entry - array['start_at','end_at','asleep_minutes','core_minutes','deep_minutes','rem_minutes',
          'awake_minutes','unspecified_minutes','resting_hr','hrv_ms']) <> '{}'::jsonb
        or coalesce((entry->>'start_at') !~ stamp_pattern, true)
        or coalesce((entry->>'end_at') !~ stamp_pattern, true) then
        raise exception using errcode = '22023';
      end if;
      start_time := (entry->>'start_at')::timestamptz;
      end_time := (entry->>'end_at')::timestamptz;
      entry_day := (end_time at time zone 'America/Los_Angeles')::date;
      if entry_day = any(seen_days) then raise exception using errcode = '22023'; end if;
      seen_days := array_append(seen_days, entry_day);
      if end_time <= start_time or end_time > observed + interval '2 minutes'
        or end_time - start_time > interval '20 hours' or entry_day > pacific_today
        or entry_day < pacific_today - 90 then
        raise exception using errcode = '22023';
      end if;

      core := (entry->>'core_minutes')::integer;
      deep := (entry->>'deep_minutes')::integer;
      rem := (entry->>'rem_minutes')::integer;
      awake := (entry->>'awake_minutes')::integer;
      unstaged := (entry->>'unspecified_minutes')::integer;
      resting := (entry->>'resting_hr')::numeric;
      variability := (entry->>'hrv_ms')::numeric;
      known := coalesce(core, 0) + coalesce(deep, 0) + coalesce(rem, 0) + coalesce(unstaged, 0);
      asleep := coalesce((entry->>'asleep_minutes')::integer,
        case when core is not null and deep is not null and rem is not null then known end);
      elapsed := ceil(extract(epoch from end_time - start_time) / 60);
      if asleep is null or awake < 0 or unstaged < 0 or known > asleep + 2
        or (core is not null and deep is not null and rem is not null and unstaged is not null and asleep > known + 2)
        or asleep + coalesce(awake, 0) > elapsed + 2 then
        raise exception using errcode = '22023';
      end if;

      insert into public.daybaseline_sleep as previous (
        user_id, day, start_at, end_at, asleep_minutes, core_minutes, deep_minutes, rem_minutes,
        awake_minutes, resting_hr, hrv_ms, observed_at, received_at
      ) values (
        owner_id, entry_day, start_time, end_time, asleep, core, deep, rem, awake, resting, variability, observed, now()
      )
      on conflict (user_id, day) do update set
        start_at = excluded.start_at, end_at = excluded.end_at, asleep_minutes = excluded.asleep_minutes,
        core_minutes = coalesce(excluded.core_minutes, case when previous.start_at = excluded.start_at and previous.end_at = excluded.end_at and previous.asleep_minutes = excluded.asleep_minutes and excluded.core_minutes is null and excluded.deep_minutes is null and excluded.rem_minutes is null then previous.core_minutes end),
        deep_minutes = coalesce(excluded.deep_minutes, case when previous.start_at = excluded.start_at and previous.end_at = excluded.end_at and previous.asleep_minutes = excluded.asleep_minutes and excluded.core_minutes is null and excluded.deep_minutes is null and excluded.rem_minutes is null then previous.deep_minutes end),
        rem_minutes = coalesce(excluded.rem_minutes, case when previous.start_at = excluded.start_at and previous.end_at = excluded.end_at and previous.asleep_minutes = excluded.asleep_minutes and excluded.core_minutes is null and excluded.deep_minutes is null and excluded.rem_minutes is null then previous.rem_minutes end),
        awake_minutes = coalesce(excluded.awake_minutes, case when previous.start_at = excluded.start_at and previous.end_at = excluded.end_at and previous.asleep_minutes = excluded.asleep_minutes then previous.awake_minutes end),
        resting_hr = coalesce(excluded.resting_hr, previous.resting_hr),
        hrv_ms = coalesce(excluded.hrv_ms, previous.hrv_ms),
        observed_at = excluded.observed_at, received_at = excluded.received_at
      where excluded.observed_at > previous.observed_at;
      get diagnostics affected = row_count;
      saved_sleep := saved_sleep + affected;
    end loop;

    for entry in select value from jsonb_array_elements(coalesce(p_payload->'reports', '[]')) loop
      if jsonb_typeof(entry) <> 'object'
        or (entry - array['day','kind','summary','advice','trend_30','coverage_days']) <> '{}'::jsonb
        or coalesce((entry->>'day') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$', true)
        or jsonb_typeof(entry->'summary') is distinct from 'string'
        or jsonb_typeof(entry->'advice') is distinct from 'string'
        or jsonb_typeof(coalesce(entry->'trend_30', 'null')) not in ('string', 'null') then
        raise exception using errcode = '22023';
      end if;
      entry_day := (entry->>'day')::date;
      if ((entry->>'kind') || ':' || entry_day::text) = any(seen_reports) then
        raise exception using errcode = '22023';
      end if;
      seen_reports := array_append(seen_reports, (entry->>'kind') || ':' || entry_day::text);
      coverage := (entry->>'coverage_days')::integer;
      if entry_day > pacific_today or entry_day < pacific_today - 90
        or (entry->>'kind' = 'daily' and (coverage > 1 or entry->>'trend_30' is not null)) then
        raise exception using errcode = '22023';
      end if;

      insert into public.daybaseline_reports as previous (
        user_id, kind, day, summary, advice, trend_30, coverage_days, observed_at
      ) values (
        owner_id, entry->>'kind', entry_day, btrim(entry->>'summary'), btrim(entry->>'advice'),
        nullif(btrim(entry->>'trend_30'), ''), coverage, observed
      )
      on conflict (user_id, kind, day) do update set
        summary = excluded.summary, advice = excluded.advice,
        trend_30 = coalesce(excluded.trend_30, previous.trend_30),
        coverage_days = coalesce(excluded.coverage_days, previous.coverage_days),
        observed_at = excluded.observed_at
      where excluded.observed_at > previous.observed_at;
      get diagnostics affected = row_count;
      saved_reports := saved_reports + affected;
    end loop;
  exception when data_exception or integrity_constraint_violation then
    return jsonb_build_object('status', 422, 'error', 'invalid_sleep_batch');
  end;

  return jsonb_build_object('status', 200, 'nights_saved', saved_sleep, 'reports_saved', saved_reports);
end
$$;

revoke all on function public.daybaseline_sync_sleep(text, jsonb) from public, anon, authenticated;
grant execute on function public.daybaseline_sync_sleep(text, jsonb) to anon;

-- Read account-wide status under the same owner policy as the nightly records.
create or replace function public.daybaseline_sleep_status()
returns table (
  latest_received_at timestamptz, latest_observed_at timestamptz, latest_wake_day date,
  coverage_7 integer, coverage_30 integer
)
language sql stable security invoker set search_path = '' as $$
  select max(n.received_at), max(n.observed_at), max(n.day),
    count(*) filter (where n.day between d.today - 6 and d.today)::integer,
    count(*) filter (where n.day between d.today - 29 and d.today)::integer
  from public.daybaseline_sleep n
  cross join (select (now() at time zone 'America/Los_Angeles')::date as today) d
  where n.user_id = (select auth.uid());
$$;
revoke all on function public.daybaseline_sleep_status() from public, anon, authenticated;
grant execute on function public.daybaseline_sleep_status() to authenticated;

-- Account owners can see connection status, issue one scoped key, or revoke all sleep keys.
-- Only the creation response returns the raw secret.
create or replace function public.daybaseline_sleep_credential(p_action text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  owner_id uuid := auth.uid();
  current_expiry timestamptz;
  secret text;
begin
  if owner_id is null then raise exception 'login required' using errcode = '42501'; end if;
  if p_action is null or p_action not in ('status','create','revoke') then
    raise exception 'invalid action' using errcode = '22023';
  end if;

  if p_action = 'status' then
    select max(k.expires_at) into current_expiry from cut_log_private.agent_keys k
      where k.user_id = owner_id and k.can_sync_sleep and k.revoked_at is null and k.expires_at > now();
    return jsonb_build_object('expires_at', current_expiry);
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(owner_id::text, 6314));
  if p_action = 'revoke' then
    update cut_log_private.agent_keys set revoked_at = now()
      where user_id = owner_id and can_sync_sleep and revoked_at is null;
    return jsonb_build_object('expires_at', null);
  end if;

  select max(k.expires_at) into current_expiry from cut_log_private.agent_keys k
    where k.user_id = owner_id and k.can_sync_sleep and k.revoked_at is null and k.expires_at > now();
  if current_expiry is not null then raise exception 'revoke current credential first' using errcode = '23505'; end if;

  secret := 'sleep_' || replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  current_expiry := now() + interval '180 days';
  insert into cut_log_private.agent_keys (token_hash, user_id, label, expires_at, can_sync_sleep)
    values (encode(sha256(convert_to(secret, 'UTF8')), 'hex'), owner_id, 'DayBaseline sleep', current_expiry, true);
  return jsonb_build_object('expires_at', current_expiry, 'token', secret);
end
$$;
revoke all on function public.daybaseline_sleep_credential(text) from public, anon, authenticated;
grant execute on function public.daybaseline_sleep_credential(text) to authenticated;
notify pgrst, 'reload schema';
commit;
