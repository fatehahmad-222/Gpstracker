-- ============================================================================
-- 0009 — GPS Work Force Monitor: enrich the existing ping tables
-- ----------------------------------------------------------------------------
-- The spec asks for a `location_pings` table. We deliberately EXTEND the
-- existing `locations` table instead of adding a second one, because:
--   * `location_pings` is a strict superset of `locations`
--   * `handle_location_insert` (0001) already maintains `live_locations` and
--     auto-completes geofenced tasks on every insert — duplicating the write
--     would double that trigger cost
--   * `locations` is already in the realtime publication and is read by
--     HistoryMap / AnimatedMarker / useLiveOverview
--   * one append-only table keeps the 9.1 retention job simple
-- ============================================================================

alter table public.locations add column if not exists battery_pct smallint
  check (battery_pct is null or (battery_pct between 0 and 100));
alter table public.locations add column if not exists provider text;
alter table public.locations add column if not exists is_mock boolean not null default false;
alter table public.locations add column if not exists state text not null default 'live'
  check (state in ('live', 'offline', 'no_gps'));
alter table public.locations add column if not exists source text not null default 'mobile_app';
alter table public.locations add column if not exists client_event_id text;

alter table public.live_locations add column if not exists battery_pct smallint
  check (battery_pct is null or (battery_pct between 0 and 100));
alter table public.live_locations add column if not exists is_mock boolean not null default false;
alter table public.live_locations add column if not exists state text not null default 'live'
  check (state in ('live', 'offline', 'no_gps'));

-- Idempotent ping ingestion. Partial index so NULL client_event_id rows
-- (the old Fleet Console writer) are unaffected.
create unique index if not exists locations_client_event_idx
  on public.locations (employee_id, client_event_id)
  where client_event_id is not null;

-- Dashboard / attendance queries all filter by company + time window.
create index if not exists locations_company_state_idx
  on public.locations (company_id, recorded_at desc)
  include (employee_id, state);

-- ---------------------------------------------------------------------------
-- Carry the new columns through the existing trigger so `live_locations`
-- stays the single "latest position" row the current maps already read.
-- ---------------------------------------------------------------------------
create or replace function public.handle_location_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.live_locations
    (employee_id, company_id, lat, lng, accuracy, speed, heading, recorded_at,
     battery_pct, is_mock, state)
  values
    (new.employee_id, new.company_id, new.lat, new.lng, new.accuracy, new.speed,
     new.heading, new.recorded_at, new.battery_pct, new.is_mock, new.state)
  on conflict (employee_id)
  do update set
    lat = excluded.lat,
    lng = excluded.lng,
    accuracy = excluded.accuracy,
    speed = excluded.speed,
    heading = excluded.heading,
    recorded_at = excluded.recorded_at,
    battery_pct = excluded.battery_pct,
    is_mock = excluded.is_mock,
    state = excluded.state;

  update public.tasks t
  set status = 'completed',
      completed_at = now(),
      completion_source = 'geofence'
  where t.employee_id = new.employee_id
    and t.status in ('pending', 'in_progress')
    and (
      6371000 * 2 * asin(
        sqrt(
          power(sin(radians((t.target_lat - new.lat) / 2)), 2)
          + cos(radians(new.lat)) * cos(radians(t.target_lat))
            * power(sin(radians((t.target_lng - new.lng) / 2)), 2)
        )
      )
    ) <= t.radius_meters;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Retention (spec 9.1: location data is sensitive and needs a retention
-- setting). A cron job calls this daily with the company's retention_days.
-- Aggregates stay; raw pings older than the window are dropped.
-- ---------------------------------------------------------------------------
create or replace function public.prune_location_history(p_company_id uuid, p_days integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cutoff timestamptz;
  v_deleted integer;
begin
  v_cutoff := now() - make_interval(days => greatest(p_days, 1));

  delete from public.locations
  where company_id = p_company_id
    and recorded_at < v_cutoff;

  get diagnostics v_deleted = row_count;

  delete from public.live_locations ll
  where ll.company_id = p_company_id
    and not exists (
      select 1 from public.locations l
      where l.employee_id = ll.employee_id
    );

  return v_deleted;
end;
$$;

revoke execute on function public.prune_location_history(uuid, integer) from public;
grant execute on function public.prune_location_history(uuid, integer) to service_role;