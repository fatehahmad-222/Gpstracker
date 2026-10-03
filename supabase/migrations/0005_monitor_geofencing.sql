-- ============================================================================
-- 0005 — GPS Work Force Monitor: geofencing
-- ----------------------------------------------------------------------------
-- Four fence types share one table. Geometry is always GeoJSON:
--   circle     -> Point, with radius_m
--   polygon    -> Polygon
--   rectangle  -> Polygon (4 corners)
--   route      -> LineString (origin -> waypoints -> destination), with buffer_m
-- ============================================================================

create table if not exists public.geofences (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,

  name text not null,
  type text not null check (type in ('circle', 'polygon', 'rectangle', 'route')),
  description text,

  geometry jsonb not null,
  center_lat double precision,
  center_lng double precision,
  radius_m numeric,

  buffer_m numeric not null default 50 check (buffer_m >= 0),
  travel_mode text check (travel_mode in ('Driving', 'Walking', 'Cycling', 'Transit')),
  color text not null default '#2563eb',

  origin jsonb,
  destination jsonb,
  waypoints jsonb not null default '[]'::jsonb,
  distance_km numeric,
  duration_min numeric,

  status text not null default 'active' check (status in ('active', 'inactive')),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists geofences_company_idx on public.geofences (company_id, status);

comment on column public.geofences.geometry is 'GeoJSON Feature/Geometry: Point, Polygon or LineString';
comment on column public.geofences.buffer_m is 'Corridor half-width in metres for route fences';

create table if not exists public.employee_geofences (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  employee_id uuid not null references public.employees (id) on delete cascade,
  geofence_id uuid not null references public.geofences (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (employee_id, geofence_id)
);

create index if not exists employee_geofences_employee_idx on public.employee_geofences (employee_id);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.geofences enable row level security;
alter table public.employee_geofences enable row level security;

drop policy if exists geofences_select on public.geofences;
create policy geofences_select on public.geofences
  for select using (public.same_company(company_id));

drop policy if exists geofences_insert on public.geofences;
create policy geofences_insert on public.geofences
  for insert with check (public.is_company_admin());

drop policy if exists geofences_update on public.geofences;
create policy geofences_update on public.geofences
  for update using (public.is_company_admin()) with check (public.is_company_admin());

drop policy if exists geofences_delete on public.geofences;
create policy geofences_delete on public.geofences
  for delete using (public.is_company_admin());

drop policy if exists employee_geofences_select on public.employee_geofences;
create policy employee_geofences_select on public.employee_geofences
  for select using (
    public.current_role() in ('admin', 'viewer') or public.is_my_employee(employee_id)
  );

drop policy if exists employee_geofences_insert on public.employee_geofences;
create policy employee_geofences_insert on public.employee_geofences
  for insert with check (public.is_company_admin());

drop policy if exists employee_geofences_delete on public.employee_geofences;
create policy employee_geofences_delete on public.employee_geofences
  for delete using (public.is_company_admin());

grant select on table public.geofences, public.employee_geofences to anon, authenticated, service_role;
grant insert, update, delete on table public.geofences to authenticated, service_role;
grant insert, delete on table public.employee_geofences to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Realtime so the map updates when a fence is edited from another tab.
-- ---------------------------------------------------------------------------
do $$
begin
  begin
    alter publication supabase_realtime add table public.geofences;
  exception when duplicate_object then null;
  end;
end $$;