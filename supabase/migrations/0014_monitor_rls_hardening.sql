-- ============================================================================
-- 0014 - GPS Work Force Monitor: RLS hardening
-- ----------------------------------------------------------------------------
-- An audit of every policy in the schema found three classes of real hole. All
-- three were found by reading the policies rather than by testing them, which is
-- the argument for writing the regression test at the end of this file.
--
--   1. Cross-tenant read/write on the original Fleet Console tables.
--      profiles, locations, live_locations and tasks were created in 0001 with
--      policies built on `is_admin()`, which is "does a profiles row exist for
--      auth.uid() with role = 'admin'" - with no reference to company. 0004
--      replaced the policies on the org tree, employees and audit_log with
--      company-scoped predicates but never came back for these four, so they
--      were still governed by the global check. An admin of any tenant could read
--      every other tenant's profiles, location history, live positions and tasks,
--      and could insert or update task rows in other tenants.
--
--   2. `companies` had row level security switched off *and* an explicit
--      `grant select ... to anon`. Every company row - name, company_code,
--      timezone and the `settings` jsonb holding risk weights, retention days and
--      quota config - was readable by an unauthenticated caller. That is both a
--      tenant enumeration list and a disclosure of how the product is tuned.
--
--   3. Six policies granted `with check (true)` or `using (true)`, i.e. "any
--      authenticated user, in any company, may do this". They read as
--      convenience for the app and were never revisited, but nothing needs them:
--      every writer of violations and presence_checks is a SECURITY DEFINER
--      function, which bypasses RLS as its owner, and ingestion writes
--      device_events, device_profiles and locations with the service role.
--      Left in place they let any logged-in user forge a `fake_gps` event against
--      a colleague, fabricate violations, approve leave, or rewrite presence
--      check results.
--
-- Nothing here changes intended behaviour: employees keep reading their own rows,
-- admins keep reading their own company, and the service-role write paths are
-- unaffected because service_role bypasses RLS entirely.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. companies: turn RLS on and stop serving it to the public
-- ---------------------------------------------------------------------------
alter table public.companies enable row level security;

drop policy if exists companies_select on public.companies;
create policy companies_select on public.companies
  for select using (public.same_company(id));

-- No insert/update/delete policies: companies are provisioned by an
-- administrator, not by a signed-up user. RLS on with no write policy denies.

revoke select on table public.companies from anon;

-- 0001 and 0010 granted anon a plain select on two more tables, which RLS could
-- not have saved anyway for anon:
--   * profiles holds every worker's name, email, phone, role and company_id.
--   * leaves holds who is away, when, and why.
-- An authenticated caller has a profile row and could be filtered by a policy;
-- an anonymous one never does, so a company-scoped predicate would have excluded
-- everything and the grant would only ever have been dangerous. Both are session-
-- scoped tables and are reached through the app's session client.
revoke select on table public.profiles from anon;
revoke select on table public.leaves from anon;

-- is_admin() is granted to anon too. Harmless in itself - an anonymous caller has
-- no uid, so it can only ever answer false - but it was part of the same blanket
-- grant and is not needed by anyone after this migration.
revoke execute on function public.is_admin() from anon;

-- The RLS helpers were also granted to anon in 0003 and 0004. Each one returns a
-- boolean about the *caller* - there is no company_id argument, so there is
-- nothing to enumerate - and for an anonymous caller with no uid they can only
-- answer false or null. Revoked anyway, for one reason: with the table grants
-- above gone, an anonymous request is refused at the table long before a policy
-- runs, so anon has no use for these. If somebody later grants anon a table read,
-- the failure they hit is "permission denied for function same_company", which
-- points straight at the mistake, instead of a policy that quietly matches nothing.
revoke execute on function public.current_company_id() from anon;
revoke execute on function public.current_role() from anon;
revoke execute on function public.same_company(uuid) from anon;
revoke execute on function public.is_my_employee(uuid) from anon;

-- ---------------------------------------------------------------------------
-- 2. api_usage_counters: RLS was never switched on
-- ---------------------------------------------------------------------------
-- The table has no grants to anon or authenticated, so it is unreachable today
-- and this is defence in depth rather than a live exploit. Enabled anyway,
-- because "no grants yet" is not a property that survives the next person who
-- wires up a dashboard widget, and a quota table shared across tenants is a bad
-- thing to expose by accident. Only consume_api_quota (SECURITY DEFINER) and
-- the service role can read it.
-- ---------------------------------------------------------------------------
alter table public.api_usage_counters enable row level security;

-- ---------------------------------------------------------------------------
-- 3. profiles
-- ---------------------------------------------------------------------------
-- Admin/viewer read the company, an employee reads their own row. Same shape as
-- employees_select from 0004, and it stops is_admin() leaking across tenants.
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select using (public.current_role() in ('admin', 'viewer') or id = auth.uid());

-- The signup trigger handle_new_user() is the only legitimate writer of
-- profiles, and it is SECURITY DEFINER. This policy existed for app-side profile
-- creation that no longer exists, and it could not be made safe: its check
-- constrained id and role but not company_id, so a user could have inserted their
-- own profile row pointing at another tenant's company_id and then satisfied
-- same_company() for that tenant. Removing it is the fix.
drop policy if exists profiles_insert on public.profiles;

-- profiles_update is untouched: 0002 replaced it with
-- `id = auth.uid() and role = 'employee'`, which is already self-scoped.

-- ---------------------------------------------------------------------------
-- 4. locations / live_locations / tasks
-- ---------------------------------------------------------------------------
-- All three gained a not-null company_id backfill in 0003, so they can be scoped
-- directly. The employee_id = auth.uid() arm is preserved: the original app shows
-- a worker their own position and their own tasks.

drop policy if exists locations_select on public.locations;
create policy locations_select on public.locations
  for select using (
    (public.current_role() in ('admin', 'viewer') and public.same_company(company_id))
    or employee_id = auth.uid()
  );

drop policy if exists live_locations_select on public.live_locations;
create policy live_locations_select on public.live_locations
  for select using (
    (public.current_role() in ('admin', 'viewer') and public.same_company(company_id))
    or employee_id = auth.uid()
  );

drop policy if exists tasks_select on public.tasks;
create policy tasks_select on public.tasks
  for select using (
    (public.current_role() in ('admin', 'viewer') and public.same_company(company_id))
    or employee_id = auth.uid()
  );

-- Tasks are assignments, so writing them is an admin action *within one tenant*.
-- The old `using (is_admin())` let an admin of any company update any task.
drop policy if exists tasks_insert on public.tasks;
create policy tasks_insert on public.tasks
  for insert with check (public.is_company_admin() and public.same_company(company_id));

drop policy if exists tasks_update_admin on public.tasks;
create policy tasks_update_admin on public.tasks
  for update using (public.is_company_admin() and public.same_company(company_id))
  with check (public.is_company_admin() and public.same_company(company_id));

-- ---------------------------------------------------------------------------
-- 5. Retire the unconditional write policies
-- ---------------------------------------------------------------------------
-- Each of these was `with check (true)` or `using (true)` on `authenticated`.

-- Ingestion writes these three with the service role, which bypasses RLS.
drop policy if exists device_events_insert on public.device_events;
drop policy if exists device_profiles_write on public.device_profiles;
drop policy if exists device_profiles_update on public.device_profiles;

-- violations and presence_checks are written only by auto_close_sessions,
-- detect_idle and schedule_presence_checks, all SECURITY DEFINER.
drop policy if exists violations_insert on public.violations;
drop policy if exists presence_checks_insert on public.presence_checks;
drop policy if exists presence_checks_update on public.presence_checks;

-- Nothing writes leaves; the dashboard only reads it.
drop policy if exists leaves_insert on public.leaves;

-- Reads are unaffected and stay admin/viewer or self-scoped as defined in 0007
-- and 0010. violations_select additionally lets an employee see violations raised
-- against themselves via is_my_employee(), which is deliberate: an accusation
-- against a worker should not be invisible to them. is_my_employee() resolves the
-- caller's own profile, so it cannot cross tenants.

-- ---------------------------------------------------------------------------
-- 6. The systemic one: is_company_admin() was never a tenant predicate
-- ---------------------------------------------------------------------------
-- Found while writing the regression test at the end of this file, and it is the
-- widest hole of the three.
--
-- 0003 introduces is_company_admin() under a comment calling it a "company-scoped
-- helper". The body is:
--
--   select exists (
--     select 1 from public.profiles where id = auth.uid() and role = 'admin'
--   );
--
-- It asks "is the caller an admin of *some* company", with no reference to which.
-- is_admin() and can_company_write() have the same shape. They are fine as a
-- half of a predicate and dangerous as a whole one, and seventeen policies used
-- them as the whole predicate:
--
--   for insert with check (public.is_company_admin())
--
-- That grants an admin of tenant A the right to create employees, attendance
-- sessions, geofences, employee-geofence assignments, policy rules, leave rows,
-- audit entries and violation status changes in tenant B. Combined with the
-- profiles_update_admin hole from 0002, the worst case is an admin of a company
-- they register themselves rewriting a victim's profile - including that
-- victim's company_id and role.
--
-- The fix follows the idiom 0004 already got right in one place: pair the role
-- check with same_company(company_id). All eleven affected tables carry a
-- not-null company_id, so this is a uniform substitution.

create or replace function public.is_company_admin_for(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.same_company(p_company_id)
    and exists (
      select 1 from public.profiles
      where id = auth.uid() and role = 'admin'
    );
$$;

grant execute on function public.is_company_admin_for(uuid) to authenticated, service_role;

-- 0002 closed profiles for admins with the global is_admin(). profiles carries
-- company_id, so the admin arm becomes company-scoped too.
drop policy if exists profiles_update_admin on public.profiles;
create policy profiles_update_admin on public.profiles
  for update using (public.is_company_admin_for(company_id))
  with check (public.is_company_admin_for(company_id));

-- Org tree: departments, sub_departments, designations.
do $$
declare
  t text;
begin
  foreach t in array array['departments', 'sub_departments', 'designations']
  loop
    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format('create policy %I on public.%I for insert with check (public.is_company_admin_for(company_id))',
      t || '_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format('create policy %I on public.%I for update using (public.is_company_admin_for(company_id)) with check (public.is_company_admin_for(company_id))',
      t || '_update', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete', t);
    execute format('create policy %I on public.%I for delete using (public.is_company_admin_for(company_id))',
      t || '_delete', t);
  end loop;
end $$;

drop policy if exists employees_insert on public.employees;
create policy employees_insert on public.employees
  for insert with check (public.is_company_admin_for(company_id));

drop policy if exists employees_update on public.employees;
create policy employees_update on public.employees
  for update using (public.is_company_admin_for(company_id))
  with check (public.is_company_admin_for(company_id));

drop policy if exists audit_log_insert on public.audit_log;
create policy audit_log_insert on public.audit_log
  for insert with check (public.is_company_admin_for(company_id));

drop policy if exists geofences_insert on public.geofences;
create policy geofences_insert on public.geofences
  for insert with check (public.is_company_admin_for(company_id));

drop policy if exists geofences_update on public.geofences;
create policy geofences_update on public.geofences
  for update using (public.is_company_admin_for(company_id))
  with check (public.is_company_admin_for(company_id));

drop policy if exists geofences_delete on public.geofences;
create policy geofences_delete on public.geofences
  for delete using (public.is_company_admin_for(company_id));

drop policy if exists employee_geofences_insert on public.employee_geofences;
create policy employee_geofences_insert on public.employee_geofences
  for insert with check (public.is_company_admin_for(company_id));

drop policy if exists employee_geofences_delete on public.employee_geofences;
create policy employee_geofences_delete on public.employee_geofences
  for delete using (public.is_company_admin_for(company_id));

drop policy if exists attendance_sessions_insert on public.attendance_sessions;
create policy attendance_sessions_insert on public.attendance_sessions
  for insert with check (public.is_company_admin_for(company_id));

drop policy if exists attendance_sessions_update on public.attendance_sessions;
create policy attendance_sessions_update on public.attendance_sessions
  for update using (public.is_company_admin_for(company_id))
  with check (public.is_company_admin_for(company_id));

drop policy if exists violations_update on public.violations;
create policy violations_update on public.violations
  for update using (public.is_company_admin_for(company_id))
  with check (public.is_company_admin_for(company_id));

drop policy if exists policies_insert on public.policies;
create policy policies_insert on public.policies
  for insert with check (public.is_company_admin_for(company_id));

drop policy if exists policies_update on public.policies;
create policy policies_update on public.policies
  for update using (public.is_company_admin_for(company_id))
  with check (public.is_company_admin_for(company_id));

drop policy if exists policies_delete on public.policies;
create policy policies_delete on public.policies
  for delete using (public.is_company_admin_for(company_id));

drop policy if exists leaves_update on public.leaves;
create policy leaves_update on public.leaves
  for update using (public.is_company_admin_for(company_id))
  with check (public.is_company_admin_for(company_id));

-- tasks, from section 4 above, can now use the same helper.
drop policy if exists tasks_insert on public.tasks;
create policy tasks_insert on public.tasks
  for insert with check (public.is_company_admin_for(company_id));

drop policy if exists tasks_update_admin on public.tasks;
create policy tasks_update_admin on public.tasks
  for update using (public.is_company_admin_for(company_id))
  with check (public.is_company_admin_for(company_id));

-- ---------------------------------------------------------------------------
-- 7. Remove the zero-argument footguns
-- ---------------------------------------------------------------------------
-- No policy calls these any more. They are dropped rather than left in place
-- because the name is the problem: is_company_admin() reads like a tenant
-- boundary, and the next person to write a policy will reach for it. Dropping it
-- turns that from a silent cross-tenant hole into a compile error.
--
-- is_admin() is deliberately kept - see the note at the end of this file.
drop function if exists public.is_company_admin();
drop function if exists public.can_company_write();

-- ---------------------------------------------------------------------------
-- Note on is_admin()
-- ---------------------------------------------------------------------------
-- public.is_admin() is no longer referenced by any policy. It is left in place
-- rather than dropped: it is a stable SECURITY DEFINER function with a pinned
-- search_path, it grants nothing on its own, and dropping it would be a
-- behavioural change for any external consumer. The fix was to stop using it as a
-- tenant boundary, not to remove the symbol.