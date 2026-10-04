-- 0021_monitor_revoke_authenticated_definers.sql
-- Stop any signed-in account from calling state-changing SECURITY DEFINER
-- functions directly.
--
-- How this hole got here: Supabase applies a platform-level default grant of
-- EXECUTE on new functions in `public` to anon and authenticated. Migrations that
-- only say `revoke ... from public` therefore leave the function callable by every
-- logged-in user, and because these are SECURITY DEFINER they run with the
-- definer's rights and ignore RLS.
--
-- 0016 closed this for anon and measured the result, but left authenticated
-- untouched. Re-measuring the live project afterwards found 17 of the 18 SECURITY
-- DEFINER functions in `public` still executable by authenticated, including
-- reconcile_geofence_session (fixed in 0019).
--
-- The damaging ones take a caller-supplied company id:
--
--   * upsert_employee_position -- move any employee, in any tenant, on the live
--     map. Every position in the product is forgeable by a signed-in employee.
--   * prune_location_history   -- delete location history for any tenant.
--   * auto_close_sessions      -- clock other people out.
--   * detect_idle              -- manufacture idle violations for anyone.
--   * consume_api_quota        -- burn another tenant's request allowance.
--   * recompute_attendance_daily, schedule_presence_checks -- rewrite rollups.
--   * write_audit              -- forge audit entries. Nothing in the app calls
--     it; lib/server/api.js writes to audit_log directly instead.
--
-- What is deliberately NOT revoked, because revoking it breaks the product:
--
--   * start_task          - the employee app calls it from a signed-in session.
--   * same_company, current_role, is_admin, is_company_admin_for,
--     is_my_employee, current_company_id - these are referenced inside RLS
--     policies and are evaluated as the querying role, so they must stay
--     executable by it.
--   * handle_new_user, handle_location_insert - trigger entry points; privilege is
--     not what guards those, the trigger binding is.
--
-- Every revoke below was checked against the callers in this repo first: each of
-- these functions is reached either through adminClient()/service_role or not at
-- all.
-- ============================================================================

do $$
declare
  v_fn text;
  v_missing text[] := array[]::text[];
  v_signature text;
  -- Names only. The argument list is resolved from pg_proc below so that an
  -- overload cannot be missed, and so this migration does not have to be edited
  -- every time a signature gains an argument.
  v_targets text[] := array[
    'reconcile_geofence_session',
    'upsert_employee_position',
    'prune_location_history',
    'auto_close_sessions',
    'detect_idle',
    'consume_api_quota',
    'recompute_attendance_daily',
    'schedule_presence_checks',
    'write_audit'
  ];
begin
  foreach v_fn in array v_targets loop
    -- Comma-separated, fully qualified signatures for every overload of this name.
    select string_agg(
             format('%I.%I(%s)', n.nspname, p.proname,
                    pg_get_function_identity_arguments(p.oid)),
             ', '
           )
      into v_signature
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = v_fn;

    if v_signature is null then
      -- Fail loudly. A silently skipped revoke would read as a clean apply while
      -- leaving the function exposed.
      v_missing := v_missing || v_fn;
    else
      execute format('revoke execute on function %s from public', v_signature);
      execute format('revoke execute on function %s from authenticated', v_signature);
    end if;
  end loop;

  if array_length(v_missing, 1) is not null then
    raise exception '0021: expected functions not found in schema public: %',
      array_to_string(v_missing, ', ');
  end if;
end
$$;

comment on function public.reconcile_geofence_session(uuid, uuid, double precision, double precision, timestamptz) is
  'Opens an attendance session when a ping lands inside the area assigned to the employee and closes it when they leave. '
  'Called from the ingestion path; close requires 2 consecutive out-of-area pings so boundary flapping cannot shred the day record. '
  'Idempotent per ping timestamp, so a retried batch cannot count a departure twice. '
  'service_role only: it acts on caller-supplied coordinates, so a browser session must not be able to invoke it.';