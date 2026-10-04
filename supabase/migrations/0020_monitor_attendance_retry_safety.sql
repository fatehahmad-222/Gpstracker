-- 0020_monitor_attendance_retry_safety.sql
-- Make the out-of-area streak survive a retried batch.
--
-- 0019 counted a departure per *call* to reconcile_geofence_session(). That reads
-- correctly against a stream of distinct pings, but ingestion is retryable: the
-- phone resends a batch when the response is lost, and the same batch can arrive
-- twice. The replay is not filtered on the way in:
--
--   * device_events dedupes on client_event_id, so the *message* is safe --
--     0019 relies on that and it works.
--   * upsert_employee_position() refuses to rewind the map, but a replay carries
--     the *same* recorded_at, so the row still equals p_at.
--
-- 0019's guard is `employee_positions.recorded_at > p_at`, which a replay does not
-- trip, because the replay is equal rather than older. So the retried copy of the
-- FIRST out-of-area ping landed a second strike and closed the session -- the
-- opposite of the agreed rule that leaving takes two consecutive outside pings.
--
-- The fix records how far this session has been reconciled. A ping at or before
-- that mark has already been counted and is reported back untouched, so attendance
-- advances once per distinct fix rather than once per delivery attempt. This lives
-- in the database rather than in the ingest handler because the invariant is about
-- attendance correctness and payroll depends on it; a future caller should not be
-- able to break it by forgetting a check.
-- ============================================================================

alter table public.attendance_sessions
  add column if not exists last_reconciled_at timestamptz;

comment on column public.attendance_sessions.last_reconciled_at is
  'Newest ping already accounted for against this session. A ping at or before this '
  'timestamp is a redelivery, not a new observation, and must not move out_strikes.';

create or replace function public.reconcile_geofence_session(
  p_company_id uuid,
  p_employee_id uuid,
  p_lat double precision,
  p_lng double precision,
  p_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_assigned boolean;
  v_fence uuid;
  v_inside boolean;
  v_session public.attendance_sessions%rowtype;
  v_tz text;
  v_grace integer;
  v_shift_start smallint;
  v_day date;
  v_expected timestamptz;
begin
  -- Nothing to reconcile from: a ping with no fix cannot open or close anything.
  if p_lat is null or p_lng is null or p_at is null then
    return null;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_employee_id::text, 0));

  -- Does this employee have an area assigned at all?
  --
  -- This is deliberately separate from v_fence. "Inside nothing" and "has no
  -- area assigned" are different states, and collapsing them would mean every
  -- ping from an unassigned employee counted as a strike -- which would close
  -- the session of anyone whose geofence had been unassigned mid-shift.
  select exists (
    select 1
    from public.employee_geofences eg
    join public.geofences g on g.id = eg.geofence_id
    where eg.company_id = p_company_id
      and eg.employee_id = p_employee_id
      and g.type = 'circle'
  ) into v_assigned;

  if not v_assigned then
    -- Leave the session exactly as it is and report it back.
    select s.id into v_session
    from public.attendance_sessions s
    where s.employee_id = p_employee_id
      and s.company_id = p_company_id
      and s.clock_out_at is null
    order by s.clock_in_at desc
    limit 1;

    return v_session.id;
  end if;

  -- Fence membership, using the same haversine the location trigger uses for
  -- task completion. Smallest matching fence wins, so an employee assigned both
  -- a small depot and the large city-wide zone is credited with the depot.
  select g.id into v_fence
  from public.employee_geofences eg
  join public.geofences g on g.id = eg.geofence_id
  where eg.company_id = p_company_id
    and eg.employee_id = p_employee_id
    and g.type = 'circle'
    and g.center_lat is not null
    and g.center_lng is not null
    and 6371000 * 2 * asin(
          sqrt(
            power(sin(radians((g.center_lat - p_lat) / 2)), 2)
            + cos(radians(p_lat)) * cos(radians(g.center_lat))
              * power(sin(radians((g.center_lng - p_lng) / 2)), 2)
          )
        ) <= coalesce(g.radius_m, 0) + coalesce(g.buffer_m, 0)
  order by coalesce(g.radius_m, 0) + coalesce(g.buffer_m, 0) asc
  limit 1;

  v_inside := v_fence is not null;

  select s.* into v_session
  from public.attendance_sessions s
  where s.employee_id = p_employee_id
    and s.company_id = p_company_id
    and s.clock_out_at is null
  order by s.clock_in_at desc
  limit 1;

  -- A ping we have already accounted for. This is the redelivery case, and it has
  -- to be checked against the session rather than the position row: a replay
  -- carries the same recorded_at, so comparing timestamps on the position cannot
  -- tell a retry from a fresh observation.
  if v_session.id is not null
     and v_session.last_reconciled_at is not null
     and p_at <= v_session.last_reconciled_at then
    return v_session.id;
  end if;

  -- Refuse to act on a ping older than the newest fix already held.
  --
  -- upsert_employee_position() declines to rewind the map for exactly this
  -- reason, but without the same guard here a late-arriving retry could land a
  -- strike, or close a live session, against a position we have already moved
  -- past. Worked hours feed payroll, so this is checked in the database rather
  -- than trusted to the caller to send pings in order.
  if exists (
    select 1
    from public.employee_positions ep
    where ep.employee_id = p_employee_id
      and ep.company_id = p_company_id
      and ep.recorded_at > p_at
  ) then
    return v_session.id;
  end if;

  -- --- Arrival: open a session -------------------------------------------
  if v_inside and v_session.id is null then
    insert into public.attendance_sessions (
      company_id, employee_id, clock_in_at,
      clock_in_lat, clock_in_lng, geofence_id, source, last_reconciled_at
    )
    values (
      p_company_id, p_employee_id, p_at,
      p_lat, p_lng, v_fence, 'geofence', p_at
    )
    returning * into v_session;

    -- Late arrival. The grace period is the company setting already used by the
    -- attendance rollup (0010/0018), not a new knob.
    select coalesce(c.timezone, 'Asia/Karachi'),
           coalesce((c.settings ->> 'late_grace_minutes')::integer, 15)
    into v_tz, v_grace
    from public.companies c
    where c.id = p_company_id;

    select e.shift_start into v_shift_start
    from public.employees e
    where e.id = p_employee_id;

    v_day := (p_at at time zone v_tz)::date;
    v_expected := (v_day::timestamp + (v_shift_start || ' minutes')::interval) at time zone v_tz;

    if p_at > v_expected + make_interval(mins => v_grace) then
      insert into public.violations (
        company_id, employee_id, type, category, severity, occurred_at, status, meta
      )
      values (
        p_company_id, p_employee_id, 'late_arrival', 'attendance', 'medium', p_at, 'open',
        jsonb_build_object(
          'session_id', v_session.id,
          'shift_start', v_shift_start,
          'grace_minutes', v_grace,
          'minutes_late', floor(extract(epoch from (p_at - v_expected)) / 60)::integer
        )
      )
      on conflict do nothing;
    end if;

    return v_session.id;
  end if;

  -- --- Still inside: the streak is broken, so nothing closes ---------------
  --
  -- last_reconciled_at moves even when the streak was already zero, so the ping
  -- is treated as spent. Re-running this branch would be harmless, but leaving the
  -- mark behind would let the same fix be reconsidered later.
  if v_inside then
    update public.attendance_sessions
    set out_strikes = 0,
        last_reconciled_at = p_at
    where id = v_session.id;

    return v_session.id;
  end if;

  -- --- Departure: strike, and close only once the streak is real ----------
  if v_session.id is null then
    return null;
  end if;

  if v_session.out_strikes + 1 < 2 then
    update public.attendance_sessions
    set out_strikes = v_session.out_strikes + 1,
        last_reconciled_at = p_at
    where id = v_session.id;

    return v_session.id;
  end if;

  update public.attendance_sessions
  set clock_out_at = p_at,
      clock_out_lat = p_lat,
      clock_out_lng = p_lng,
      out_reason = 'auto_location_off',
      out_strikes = 0,
      last_reconciled_at = p_at
  where id = v_session.id;

  -- "You are out of the area you were assigned."
  --
  -- client_event_id is derived from the session, so the phone retrying the batch
  -- that triggered this close cannot produce a second message.
  insert into public.device_events (
    company_id, employee_id, type, severity, occurred_at,
    session_id, client_event_id, meta
  )
  values (
    p_company_id, p_employee_id, 'out_of_zone', 'medium', p_at,
    v_session.id, 'fence-out:' || v_session.id::text,
    jsonb_build_object(
      'lat', p_lat,
      'lng', p_lng,
      'closed_session_id', v_session.id,
      'out_reason', 'auto_location_off'
    )
  )
  on conflict do nothing;

  return v_session.id;
end;
$fn$;

revoke execute on function public.reconcile_geofence_session(uuid, uuid, double precision, double precision, timestamptz) from public;
revoke execute on function public.reconcile_geofence_session(uuid, uuid, double precision, double precision, timestamptz) from authenticated;
grant execute on function public.reconcile_geofence_session(uuid, uuid, double precision, double precision, timestamptz) to service_role;

comment on function public.reconcile_geofence_session(uuid, uuid, double precision, double precision, timestamptz) is
  'Opens an attendance session when a ping lands inside the area assigned to the employee and closes it when they leave. '
  'Called from the ingestion path; close requires 2 consecutive out-of-area pings so boundary flapping cannot shred the day record. '
  'Idempotent per ping timestamp, so a retried batch cannot count a departure twice.';