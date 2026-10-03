-- ============================================================================
-- 0011 — GPS Work Force Monitor: latest employee position
-- ----------------------------------------------------------------------------
-- One row per employee, holding only the most recent fix.
--
-- This is deliberately NOT a track log. `device_events` (0007) is the append-only
-- history; this table is the "where is everyone right now" projection that the
-- live map polls. Keeping it separate means the map can be as chatty as it likes
-- without touching the history table, and a corrupted or replayed fix can be
-- overwritten in place instead of corrupting the trail.
--
-- The pre-existing `live_locations` table is left alone: it is keyed on
-- `profiles(id)` for the original Fleet Console tracker and is not part of this
-- module.
-- ============================================================================

create table if not exists public.employee_positions (
  company_id uuid not null references public.companies (id) on delete cascade,
  employee_id uuid primary key references public.employees (id) on delete cascade,

  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  accuracy double precision,
  speed double precision,
  heading double precision,
  battery integer check (battery between 0 and 100),

  recorded_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- A newer fix for an older timestamp is a replay, not a movement.
  constraint employee_positions_fresh check (recorded_at <= now() + interval '5 minutes')
);

create index if not exists employee_positions_company_idx
  on public.employee_positions (company_id, recorded_at desc);

comment on table public.employee_positions is
  'Latest known position per employee for the live map; device_events holds the history.';

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.employee_positions enable row level security;

drop policy if exists employee_positions_select on public.employee_positions;
create policy employee_positions_select on public.employee_positions
  for select using (public.same_company(company_id));

-- Only the ingestion path writes here: the device and the admin session both use
-- the service role, so there is deliberately no insert/update policy for
-- authenticated users. Letting a browser write its own position would make the
-- live map spoofable.
drop policy if exists employee_positions_write on public.employee_positions;

grant select on table public.employee_positions to authenticated, service_role;
grant insert, update on table public.employee_positions to service_role;

-- ---------------------------------------------------------------------------
-- Realtime so the map can subscribe instead of only polling.
-- ---------------------------------------------------------------------------
do $$
begin
  begin
    alter publication supabase_realtime add table public.employee_positions;
  exception when duplicate_object then null;
  end;
end $$;

-- ---------------------------------------------------------------------------
-- One row per employee, upserted on each accepted fix.
--
-- The `recorded_at <= excluded.recorded_at` guard is what makes a replayed or
-- out-of-order batch harmless: a fix older than what is stored is dropped
-- rather than moving somebody backwards in time.
-- ---------------------------------------------------------------------------
create or replace function public.upsert_employee_position(
  p_company_id uuid,
  p_employee_id uuid,
  p_lat double precision,
  p_lng double precision,
  p_accuracy double precision default null,
  p_speed double precision default null,
  p_heading double precision default null,
  p_battery integer default null,
  p_recorded_at timestamptz default now()
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.employee_positions (
    company_id, employee_id, lat, lng, accuracy, speed, heading, battery, recorded_at, updated_at
  )
  values (
    p_company_id, p_employee_id, p_lat, p_lng, p_accuracy, p_speed, p_heading, p_battery,
    p_recorded_at, now()
  )
  on conflict (employee_id) do update
    set lat = excluded.lat,
        lng = excluded.lng,
        accuracy = excluded.accuracy,
        speed = excluded.speed,
        heading = excluded.heading,
        battery = excluded.battery,
        recorded_at = excluded.recorded_at,
        updated_at = now()
    where excluded.recorded_at >= public.employee_positions.recorded_at;
$$;

revoke all on function public.upsert_employee_position(uuid, uuid, double precision, double precision, double precision, double precision, double precision, integer, timestamptz) from public;