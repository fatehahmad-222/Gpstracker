-- ============================================================================
-- 0017 - GPS Work Force Monitor: fix the presence-check violation aggregation
-- ----------------------------------------------------------------------------
-- 0012 created schedule_presence_checks() and it has never once run, because
-- the file could not be applied until its earlier CTE bug was fixed. So the
-- defect below was invisible for as long as the migration was broken - and
-- plpgsql does not catch it at creation time either, because check_function_
-- bodies only parses the body's syntax, it does not analyse the SQL statements
-- inside. The function was created happily and failed on first execution:
--
--   ERROR: column "p.params" must appear in the GROUP BY clause
--          or be used in an aggregate function
--
-- The query groups by (company_id, employee_id, policy_id) and joins policies
-- only to read params->>'notifications' for the HAVING threshold. A HAVING
-- condition has to be grouped or aggregated, and this one was neither, so the
-- whole job died on the statement that was its entire purpose: turning missed
-- presence checks into violations.
--
-- The fix is to aggregate the threshold rather than add p.params to the GROUP
-- BY. p.id = pc.policy_id makes every row in the group share one policies row,
-- so max() is exact, not an approximation - and grouping on a jsonb column
-- would put the policy configuration into the group key for no benefit.
--
-- Note this is a new migration rather than an edit to 0012, because 0012 is
-- applied. The reason the job never ran in production is worth keeping though:
-- a security definer function can be created successfully and be broken on
-- every single call, and "the migration applied" is not evidence it works.
-- ============================================================================

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
  having count(*) >= greatest(coalesce(max((p.params ->> 'notifications')::integer), 3), 1)
    and not exists (
      select 1 from public.violations v
      where v.employee_id = pc.employee_id
        and v.type = 'presence_check_missed'
        and v.status in ('open', 'acknowledged')
        and v.occurred_at > now() - interval '1 day'
    )
  on conflict do nothing;

  return v_created;
end;
$$;

revoke execute on function public.schedule_presence_checks(uuid) from public;
grant execute on function public.schedule_presence_checks(uuid) to service_role;

-- No anon revoke is needed here: `create or replace` keeps the privileges the
-- function already had, and 0016 already took anon off every function. Stated
-- because "0016 revoked anon from everything" is the kind of invariant a future
-- migration that *creates* a function rather than replaces one would break
-- silently - `create function` would pick the default privileges back up.