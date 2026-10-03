-- ============================================================================
-- 0018 - GPS Work Force Monitor: quota kinds and the attendance interval cast
-- ----------------------------------------------------------------------------
-- Two more defects that only exist in code which had never been executed. Both
-- were found by calling every SECURITY DEFINER function in the schema against
-- the live project with its real signature, after 0012 finally made them
-- compilable. Neither would have been caught by the migrations applying cleanly.
--
-- ---------------------------------------------------------------------------
-- 1. device ingestion raised 23514 on every single batch
-- ---------------------------------------------------------------------------
-- lib/server/ingest.js meters the tracker with
--
--   supabase.rpc("consume_api_quota", { p_kind: "device_ingest", ... })
--
-- but 0010 created the counter with a closed set of kinds that does not contain
-- it:
--
--   kind text not null check (kind in ('search','map_action','keystroke','map_pin'))
--
-- so the insert inside consume_api_quota violated the constraint and the RPC
-- raised. The route throws on quotaError, which means the primary ingestion
-- path - the one every tracker ping depends on - failed for every batch that
-- carried any content, and did so in the one place that is supposed to be the
-- cheap fallback path. Nothing in the E2E suite noticed because the suite stops
-- at the Authorization header and never reaches a live token.
--
-- Adding the kind rather than relaxing the constraint: the closed set is the
-- point. An open check would let the next caller invent a kind that no quota
-- dashboard groups by, which is the same failure in slower motion. The one
-- missing kind is added, so the set is now exactly what the code calls.
--
-- 'device_ingest' deliberately counts pings, not requests, because that is what
-- a quota on this table is for - the batch size is attacker-controlled, so
-- metering batches would be metering nothing.
-- ---------------------------------------------------------------------------
alter table public.api_usage_counters
  drop constraint if exists api_usage_counters_kind_check;

alter table public.api_usage_counters
  add constraint api_usage_counters_kind_check
  check (kind in ('search', 'map_action', 'keystroke', 'map_pin', 'device_ingest'));

-- ---------------------------------------------------------------------------
-- 2. recompute_attendance_daily could never run
-- ---------------------------------------------------------------------------
-- ERROR: COALESCE types interval and integer cannot be matched
--
-- The stay-seconds expression clamped a negative interval to zero with
--
--   coalesce(least(...) - greatest(...), 0)
--
-- timestamp minus timestamp is an interval, so coalescing it against the integer
-- literal 0 is a type error, raised on every call regardless of input. The
-- clamp is also written as a coalesce when it means a floor.
--
-- greatest(..., interval '0') says what was meant: a session that started before
-- the day and ended after it contributes only the overlap with the day, and
-- never a negative number of seconds. Behaviour for the real cases is
-- unchanged - only the error goes away.
-- ---------------------------------------------------------------------------
create or replace function public.recompute_attendance_daily(p_company_id uuid, p_date date)
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
      -- overlap with the day only, floored at zero rather than nulled out
      coalesce(sum(
        extract(epoch from greatest(
          least(coalesce(s.clock_out_at, s.clock_in_at), d.day_end)
          - greatest(s.clock_in_at, d.day_start),
          interval '0'
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