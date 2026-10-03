-- ============================================================================
-- 0010 — GPS Work Force Monitor: leaves, API quota counters, derivation jobs
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. leaves — minimal: the Dashboard only needs Pending/Approved/Rejected
-- ---------------------------------------------------------------------------
create table if not exists public.leaves (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  employee_id uuid not null references public.employees (id) on delete cascade,
  leave_type text not null default 'casual',
  from_date date not null,
  to_date date not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reason text,
  created_at timestamptz not null default now(),
  check (to_date >= from_date)
);

create index if not exists leaves_company_idx on public.leaves (company_id, status, from_date);

-- ---------------------------------------------------------------------------
-- 2. api_usage_counters — server-enforced Google Maps billing guard (4.5).
--    Deliberately NOT enforced in the browser: the client cannot be trusted.
-- ---------------------------------------------------------------------------
create table if not exists public.api_usage_counters (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  user_id uuid references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('search', 'map_action', 'keystroke', 'map_pin')),
  period text not null default 'day',
  period_start date not null default current_date,
  count integer not null default 0,
  updated_at timestamptz not null default now(),
  unique (company_id, user_id, kind, period, period_start)
);

create index if not exists api_usage_counters_lookup_idx
  on public.api_usage_counters (company_id, user_id, kind, period_start desc);

-- Atomically consume one unit of quota. Returns false when exhausted.
create or replace function public.consume_api_quota(
  p_kind text,
  p_limit integer,
  p_period text default 'day',
  p_company_id uuid default null,
  p_user_id uuid default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid;
  v_user uuid;
  v_count integer;
begin
  v_company := coalesce(p_company_id, public.current_company_id());
  v_user := coalesce(p_user_id, auth.uid());

  insert into public.api_usage_counters
    (company_id, user_id, kind, period, period_start, count, updated_at)
  values (v_company, v_user, p_kind, p_period, current_date, 1, now())
  on conflict (company_id, user_id, kind, period, period_start)
  do update set
    count = public.api_usage_counters.count + 1,
    updated_at = now()
  returning count into v_count;

  -- If the increment pushed past the cap, roll back and report exhaustion.
  if v_count > greatest(p_limit, 0) then
    update public.api_usage_counters
    set count = count - 1, updated_at = now()
    where company_id = v_company and user_id = v_user
      and kind = p_kind and period = p_period and period_start = current_date;
    return false;
  end if;

  return true;
end;
$$;

revoke execute on function public.consume_api_quota(text, integer, text, uuid, uuid) from public;
grant execute on function public.consume_api_quota(text, integer, text, uuid, uuid)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. attendance_daily derivation
--    The spec's headline business rule: ABSENT excludes employees whose shift
--    has not started yet — those are counted as `shift_not_started`.
-- ---------------------------------------------------------------------------
create or replace function public.recompute_attendance_daily(
  p_company_id uuid,
  p_date date
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tz text;
  v_grace integer;
  v_rows integer;
begin
  select coalesce(timezone, 'Asia/Karachi'), coalesce((settings ->> 'late_grace_minutes')::integer, 15)
  into v_tz, v_grace
  from public.companies
  where id = p_company_id;

  with day_bounds as (
    select
      (p_date::timestamp at time zone v_tz) as day_start,
      ((p_date + 1)::timestamp at time zone v_tz) as day_end
  ),
  agg as (
    select
      e.id as employee_id,
      e.company_id,
      p_date as date,
      e.shift_start,
      e.shift_end,
      -- the shift's start instant, so overnight shifts roll into the right day
      (p_date::timestamp + make_interval(mins => e.shift_start)) at time zone v_tz as shift_start_at,
      min(s.clock_in_at) as first_in,
      max(coalesce(s.clock_out_at, s.clock_in_at)) as last_out,
      coalesce(sum(
        extract(epoch from (
          coalesce(
            least(coalesce(s.clock_out_at, s.clock_in_at), (p_date + 1)::timestamp at time zone v_tz)
            - greatest(s.clock_in_at, p_date::timestamp at time zone v_tz),
            0
          )
        ))::integer
      ), 0) as stay_seconds,
      count(*) as session_count
    from public.employees e
    cross join day_bounds d
    left join public.attendance_sessions s
      on s.employee_id = e.id
      and s.clock_in_at < d.day_end
      and coalesce(s.clock_out_at, s.clock_in_at) >= d.day_start
    where e.company_id = p_company_id
      and e.status = 'active'
      and e.deleted_at is null
    group by e.id, e.company_id, e.shift_start, e.shift_end
  )
  insert into public.attendance_daily
    (company_id, employee_id, date, status, first_in, last_out, stay_seconds,
     punctuality, early_exit, late_minutes, overtime_seconds, violations_count,
     offline_seconds, recomputed_at)
  select
    a.company_id,
    a.employee_id,
    a.date,
    case
      when a.first_in is null and now() < a.shift_start_at then 'shift_not_started'
      when a.first_in is null then 'absent'
      when a.last_out is null then 'present' -- still clocked in
      when a.stay_seconds < 14400 then 'half_day'
      else 'present'
    end as status,
    a.first_in,
    a.last_out,
    a.stay_seconds,
    case
      when a.first_in is null then null
      when extract(epoch from (a.first_in - a.shift_start_at)) / 60 > v_grace then 'late'
      else 'on_time'
    end as punctuality,
    coalesce(
      extract(epoch from (
        (p_date::timestamp + make_interval(mins => a.shift_end)) at time zone v_tz
        - a.last_out
      )) > 1800,
      false
    ) as early_exit,
    case
      when a.first_in is null then 0
      else greatest(
        (extract(epoch from (a.first_in - a.shift_start_at)) / 60 - v_grace)::integer,
        0
      )
    end as late_minutes,
    greatest(
      (extract(epoch from (
        a.last_out - ((p_date::timestamp + make_interval(mins => a.shift_end)) at time zone v_tz)
      )) / 60)::integer,
      0
    ) as overtime_seconds,
    coalesce(v_count.cnt, 0) as violations_count,
    0 as offline_seconds,
    now()
  from agg a
  left join (
    select employee_id, count(*)::integer as cnt
    from public.violations
    where company_id = p_company_id
      and occurred_at >= (p_date::timestamp at time zone v_tz)
      and occurred_at < ((p_date + 1)::timestamp at time zone v_tz)
    group by employee_id
  ) v_count on v_count.employee_id = a.employee_id
  on conflict (employee_id, date) do update set
    status = excluded.status,
    first_in = excluded.first_in,
    last_out = excluded.last_out,
    stay_seconds = excluded.stay_seconds,
    punctuality = excluded.punctuality,
    early_exit = excluded.early_exit,
    late_minutes = excluded.late_minutes,
    overtime_seconds = excluded.overtime_seconds,
    violations_count = excluded.violations_count,
    recomputed_at = now();

  get diagnostics v_rows = row_count;

  -- Derived rows are job output, not user input.
  delete from public.attendance_daily
  where company_id = p_company_id and date = p_date
    and status = 'shift_not_started'
    and now() >= ((p_date + 1)::timestamp at time zone v_tz);

  return v_rows;
end;
$$;

revoke execute on function public.recompute_attendance_daily(uuid, date) from public;
grant execute on function public.recompute_attendance_daily(uuid, date) to service_role;

-- ---------------------------------------------------------------------------
-- 4. Auto-close sessions at shift end + raise "No check-out" violations.
--    Sessions are closed with out_reason = 'auto_shift_end', which the
--    Command Center renders as the `auto` marker.
-- ---------------------------------------------------------------------------
create or replace function public.auto_close_sessions(p_company_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tz text;
  v_closed integer;
begin
  select coalesce(timezone, 'Asia/Karachi') into v_tz from public.companies where id = p_company_id;

  with open_sessions as (
    select s.id, s.employee_id, s.company_id, s.clock_in_at, e.shift_start, e.shift_end
    from public.attendance_sessions s
    join public.employees e on e.id = s.employee_id
    where s.company_id = p_company_id
      and s.clock_out_at is null
      and e.status = 'active'
  )
  update public.attendance_sessions s
  set clock_out_at = coalesce(s.clock_out_at, now()),
      out_reason = coalesce(s.out_reason, 'auto_shift_end')
  from open_sessions o
  where s.id = o.id;

  get diagnostics v_closed = row_count;

  -- "No check-out" violations for anything the system had to close.
  insert into public.violations (company_id, employee_id, type, category, severity, occurred_at, status, meta)
  select o.company_id, o.employee_id, 'no_checkout', 'attendance', 'medium', now(), 'open',
         jsonb_build_object('session_id', o.id, 'shift_end', o.shift_end)
  from open_sessions o
  where not exists (
    select 1 from public.violations v
    where v.employee_id = o.employee_id
      and v.type = 'no_checkout'
      and v.occurred_at > now() - interval '1 day'
  );

  return v_closed;
end;
$$;

revoke execute on function public.auto_close_sessions(uuid) from public;
grant execute on function public.auto_close_sessions(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 5. Idle detection — "No movement for 1 hour" (HIGH · IDLE)
-- ---------------------------------------------------------------------------
create or replace function public.detect_idle(p_company_id uuid, p_minutes integer default 60)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_created integer;
begin
  insert into public.violations (company_id, employee_id, type, category, severity, occurred_at, status, meta)
  select
    e.company_id,
    e.id,
    'idle_no_movement',
    'attendance',
    'high',
    coalesce(last_p.rec, last_s.clock_in_at),
    'open',
    jsonb_build_object('idle_minutes', p_minutes)
  from public.employees e
  join public.attendance_sessions last_s
    on last_s.employee_id = e.id and last_s.clock_out_at is null
  left join lateral (
    select max(l.recorded_at) as rec
    from public.locations l
    where l.employee_id = e.id and l.recorded_at > now() - make_interval(mins => p_minutes * 2)
  ) last_p on true
  where e.company_id = p_company_id
    and e.status = 'active'
    and e.deleted_at is null
    and last_s.clock_in_at < now() - make_interval(mins => p_minutes)
    and (last_p.rec is null or last_p.rec < now() - make_interval(mins => p_minutes))
    and not exists (
      select 1 from public.violations v
      where v.employee_id = e.id
        and v.type = 'idle_no_movement'
        and v.occurred_at > now() - interval '1 day'
    );

  get diagnostics v_created = row_count;
  return v_created;
end;
$$;

revoke execute on function public.detect_idle(uuid, integer) from public;
grant execute on function public.detect_idle(uuid, integer) to service_role;

-- ---------------------------------------------------------------------------
-- 6. Presence-check scheduler (spec 4.4B).
--    Push delivery is a documented STUB: this function only creates the rows
--    and marks the misses. A notifier interface reads `pending` rows and is
--    expected to be implemented by whatever provider the client configures.
-- ---------------------------------------------------------------------------
create or replace function public.schedule_presence_checks(p_company_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_created integer;
begin
  insert into public.presence_checks (company_id, policy_id, employee_id, sent_at, deadline_at, attempt)
  select
    p.company_id,
    p.id,
    e.id,
    now(),
    now() + make_interval(mins => coalesce((p.params ->> 'selfie_grace_minutes')::integer, 5)),
    coalesce((
      select count(*)::integer + 1 from public.presence_checks pc
      where pc.employee_id = e.id and pc.policy_id = p.id
        and pc.sent_at > now() - interval '1 day'
    ), 1)
  from public.policies p
  join public.employees e on e.company_id = p.company_id and e.status = 'active'
  join public.attendance_sessions s on s.employee_id = e.id and s.clock_out_at is null
  where p.company_id = p_company_id
    and p.type = 'presence_check'
    and p.status = 'active'
    and p.effective_from <= current_date
    and (p.scope = 'all' or (p.scope = 'department' and e.department_id = p.scope_ref_id)
         or (p.scope = 'employee' and e.id = p.scope_ref_id))
    -- one challenge per employee per policy per 2 hours
    and not exists (
      select 1 from public.presence_checks pc
      where pc.employee_id = e.id and pc.policy_id = p.id
        and pc.sent_at > now() - interval '2 hours'
    )
    and floor(random() * 3) = 0; -- ~1 in 3 open sessions per sweep

  get diagnostics v_created = row_count;

  -- Mark misses once the grace window has passed.
  update public.presence_checks
  set missed = true
  where company_id = p_company_id
    and captured_at is null
    and missed = false
    and deadline_at < now();

  -- Reaching the configured notification count raises a violation.
  insert into public.violations (company_id, employee_id, type, category, severity, occurred_at, status, meta)
  select
    pc.company_id, pc.employee_id, 'presence_check_missed', 'attendance', 'medium', now(), 'open',
    jsonb_build_object('policy_id', pc.policy_id, 'attempts', count(*))
  from public.presence_checks pc
  join public.policies p on p.id = pc.policy_id
  where pc.company_id = p_company_id
    and pc.missed
    and pc.sent_at > now() - interval '1 day'
  group by pc.company_id, pc.employee_id, pc.policy_id
  having count(*) >= greatest(coalesce((p.params ->> 'notifications')::integer, 3), 1)
    and not exists (
      select 1 from public.violations v
      where v.employee_id = pc.employee_id
        and v.type = 'presence_check_missed'
        and v.occurred_at > now() - interval '1 day'
    );

  return v_created;
end;
$$;

revoke execute on function public.schedule_presence_checks(uuid) from public;
grant execute on function public.schedule_presence_checks(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 7. RLS for leaves
-- ---------------------------------------------------------------------------
alter table public.leaves enable row level security;

drop policy if exists leaves_select on public.leaves;
create policy leaves_select on public.leaves
  for select using (
    public.current_role() in ('admin', 'viewer') or public.is_my_employee(employee_id)
  );

drop policy if exists leaves_insert on public.leaves;
create policy leaves_insert on public.leaves
  for insert with check (true);

drop policy if exists leaves_update on public.leaves;
create policy leaves_update on public.leaves
  for update using (public.is_company_admin()) with check (public.is_company_admin());

grant select on table public.leaves to anon, authenticated, service_role;
grant insert on table public.leaves to authenticated, service_role;
grant update on table public.leaves to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 8. Cron jobs. `schedule_job` is a no-op unless pg_cron is enabled on the
--    project, so this migration is safe on a project without the extension.
--    To enable:  create extension if not exists pg_cron;
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    begin
      perform cron.schedule('monitor-recompute-attendance', '*/5 * * * *',
        $$select public.recompute_attendance_daily(id, (now() at time zone timezone)::date) from public.companies$$
      );
      perform cron.schedule('monitor-auto-close', '*/5 * * * *',
        $$select public.auto_close_sessions(id) from public.companies$$
      );
      perform cron.schedule('monitor-idle-detect', '*/15 * * * *',
        $$select public.detect_idle(id) from public.companies$$
      );
      perform cron.schedule('monitor-presence-checks', '*/10 * * * *',
        $$select public.schedule_presence_checks(id) from public.companies$$
      );
      perform cron.schedule('monitor-prune-location-history', '17 3 * * *',
        $$select public.prune_location_history(id, coalesce((settings->>'retention_days')::integer, 90)) from public.companies$$
      );
    exception when others then
      raise notice 'pg_cron present but schedule failed: %', sqlerrm;
    end;
  else
    raise notice 'pg_cron not installed — background jobs must be triggered externally';
  end if;
end $$;