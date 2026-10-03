-- ============================================================================
-- 0006 — GPS Work Force Monitor: attendance
-- ----------------------------------------------------------------------------
-- attendance_sessions is the raw in/out log written by the ingestion API.
-- attendance_daily is DERIVED and recomputed by a scheduled job — never
-- written directly by the client.
-- ============================================================================

create table if not exists public.attendance_sessions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  employee_id uuid not null references public.employees (id) on delete cascade,

  clock_in_at timestamptz not null,
  clock_out_at timestamptz,

  clock_in_lat double precision,
  clock_in_lng double precision,
  clock_out_lat double precision,
  clock_out_lng double precision,

  geofence_id uuid references public.geofences (id) on delete set null,
  out_reason text check (out_reason in
    ('user', 'auto_location_off', 'auto_shift_end', 'admin', 'still_in')),
  source text not null default 'GPS APP',

  -- idempotency: the mobile app retries batches, so the same logical
  -- session must not be inserted twice.
  client_event_id text,
  created_at timestamptz not null default now(),
  unique (employee_id, clock_in_at)
);

create unique index if not exists attendance_sessions_client_event_idx
  on public.attendance_sessions (employee_id, client_event_id)
  where client_event_id is not null;

create index if not exists attendance_sessions_company_day_idx
  on public.attendance_sessions (company_id, clock_in_at desc);

create index if not exists attendance_sessions_open_idx
  on public.attendance_sessions (employee_id)
  where clock_out_at is null;

create table if not exists public.attendance_daily (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  employee_id uuid not null references public.employees (id) on delete cascade,
  date date not null,

  status text not null default 'absent' check (status in
    ('present', 'absent', 'late', 'half_day', 'shift_not_started')),
  first_in timestamptz,
  last_out timestamptz,
  stay_seconds integer not null default 0,
  punctuality text check (punctuality in ('on_time', 'late')),
  early_exit boolean not null default false,
  late_minutes integer not null default 0,
  overtime_seconds integer not null default 0,
  violations_count integer not null default 0,
  offline_seconds integer not null default 0,
  recomputed_at timestamptz not null default now(),
  unique (employee_id, date)
);

create index if not exists attendance_daily_company_date_idx
  on public.attendance_daily (company_id, date desc, status);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.attendance_sessions enable row level security;
alter table public.attendance_daily enable row level security;

drop policy if exists attendance_sessions_select on public.attendance_sessions;
create policy attendance_sessions_select on public.attendance_sessions
  for select using (
    public.current_role() in ('admin', 'viewer') or public.is_my_employee(employee_id)
  );

drop policy if exists attendance_sessions_insert on public.attendance_sessions;
create policy attendance_sessions_insert on public.attendance_sessions
  for insert with check (public.is_company_admin());

drop policy if exists attendance_sessions_update on public.attendance_sessions;
create policy attendance_sessions_update on public.attendance_sessions
  for update using (public.is_company_admin()) with check (public.is_company_admin());

drop policy if exists attendance_daily_select on public.attendance_daily;
create policy attendance_daily_select on public.attendance_daily
  for select using (
    public.current_role() in ('admin', 'viewer') or public.is_my_employee(employee_id)
  );

-- attendance_daily is derived: only the recompute job (service role) writes it.

grant select on table public.attendance_sessions, public.attendance_daily
  to anon, authenticated, service_role;
grant insert, update on table public.attendance_sessions to authenticated, service_role;