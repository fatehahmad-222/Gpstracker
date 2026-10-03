-- ============================================================================
-- 0012 - GPS Work Force Monitor: violation dedupe invariant
-- ----------------------------------------------------------------------------
-- The rule the Alerts & Violation screen runs on is "one unresolved violation
-- per employee per signal". `lib/monitor/alerts.js` implements that, but only in
-- application code, and only for a single ingestion run.
--
-- This is not enough. Events arrive from phones on their own schedule, so two
-- runs can both see the first `fake_gps` for the same person seconds apart, or a
-- retry can replay a batch after a partial failure. Either way both runs decide
-- "no unresolved violation exists" and both insert. The queue then shows the
-- same accusation twice, which is precisely the sort of thing an employee would
-- (reasonably) dispute, and the duplicate inflates every count around it.
--
-- So the invariant is pushed down to the database where it cannot race.
--
-- The index is PARTIAL and that is the whole point: it covers only `open` and
-- `acknowledged` rows. Resolving a violation removes it from the index, so the
-- same fault recurring later is correctly a *new* violation rather than an
-- update of the old one - history is preserved and the queue is not silently
-- reused.
--
-- `company_id` is in the key even though `employee_id` is already unique to a
-- company, so the constraint states the tenant explicitly and stays correct if
-- an employee is ever moved between companies.
-- ============================================================================
-- Idempotent by design: a deploy that re-runs migrations must not fail, and
-- if pre-existing duplicate rows somehow exist the index build below will make
-- that loud rather than silent.
create unique index if not exists violations_unresolved_unique
  on public.violations (company_id, employee_id, type)
  where status in ('open', 'acknowledged');

-- The Alerts screen's default view is "everything still open, newest first".
-- The existing company index is on (company_id, occurred_at desc) which already
-- covers that, but the queue filters on status first, so a partial index over
-- just the unresolved rows keeps the common case off the bigger heap.
create index if not exists violations_open_recent_idx
  on public.violations (company_id, occurred_at desc)
  where status in ('open', 'acknowledged');
-- ---------------------------------------------------------------------------
-- 6. Make the three violation-raising jobs compatible with that invariant.
-- ---------------------------------------------------------------------------
-- These functions predate `violations_unresolved_unique` and each raises
-- violations from a scheduled run. Two consequences had to be handled, and both
-- are about not turning a race into an outage:
--
--   (a) Without `on conflict do nothing`, two concurrent runs (or a retried
--       batch) would both insert and the index would raise unique_violation,
--       aborting the WHOLE batch - turning a duplicate row into a failed job
--       that then leaves every other employee unprocessed. `do nothing` keeps
--       the invariant and keeps the batch.
--
--   (b) Their `not exists` guards suppressed re-raising for 24h based on
--       `occurred_at` alone, ignoring status. That means an incident that was
--       investigated and resolved could never be raised again that day, even if
--       it happened again an hour later - the resolution silently suppressed the
--       repeat. Scoping the guard to unresolved rows fixes that and matches the
--       partial index's own condition.
--
-- Only these three bodies are replaced; the rest of 0010 is untouched, so an
-- already-migrated database picks up exactly the same behaviour it had, minus
-- the duplicate and the suppression bug.
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
      and v.status in ('open', 'acknowledged')
      and v.occurred_at > now() - interval '1 day'
  on conflict do nothing;

  return v_closed;
end;
$$;

revoke execute on function public.auto_close_sessions(uuid) from public;
grant execute on function public.auto_close_sessions(uuid) to service_role;

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
        and v.status in ('open', 'acknowledged')
        and v.occurred_at > now() - interval '1 day'
  on conflict do nothing;

  get diagnostics v_created = row_count;
  return v_created;
end;
$$;

revoke execute on function public.detect_idle(uuid, integer) from public;
grant execute on function public.detect_idle(uuid, integer) to service_role;

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
        and v.status in ('open', 'acknowledged')
        and v.occurred_at > now() - interval '1 day'
  on conflict do nothing;

  return v_created;
end;
$$;

revoke execute on function public.schedule_presence_checks(uuid) from public;
grant execute on function public.schedule_presence_checks(uuid) to service_role;
