-- ============================================================================
-- 0007 — GPS Work Force Monitor: device health, signals and violations
-- ----------------------------------------------------------------------------
-- The reference product's differentiator: every anti-fraud / device-health
-- signal is a row in `device_events` carrying BOTH the time it happened on
-- the phone (occurred_at) and the time the server received it (reported_at).
-- A gap between the two is itself an integrity signal.
-- ============================================================================

create table if not exists public.device_profiles (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  employee_id uuid not null references public.employees (id) on delete cascade,

  device_id text not null,
  model text,
  manufacturer text,
  android_version text,
  app_version text,

  last_login_at timestamptz,
  last_sync_at timestamptz,
  login_count integer not null default 0,
  sim_fingerprint_hash text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (employee_id, device_id)
);

create index if not exists device_profiles_company_idx on public.device_profiles (company_id);
create index if not exists device_profiles_sync_idx on public.device_profiles (company_id, last_sync_at);

create table if not exists public.device_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  employee_id uuid not null references public.employees (id) on delete cascade,

  type text not null check (type in (
    'data_cleared',
    'logged_in_not_synced',
    'second_device',
    'auto_time_off',
    'time_diff',
    'location_off',
    'power_off',
    'force_stop',
    'battery_restrict',
    'dead_zone',
    'developer_mode',
    'fake_gps',
    'out_of_zone',
    'heartbeat_gap',
    'impossible_travel',
    'logged_out',
    'admin_logout',
    'sim_change',
    'old_app',
    'battery_low'
  )),
  severity text not null default 'high' check (severity in ('critical', 'high', 'medium')),

  -- event time on the phone vs. when it reached the server
  occurred_at timestamptz not null,
  reported_at timestamptz not null default now(),

  session_id uuid references public.attendance_sessions (id) on delete set null,
  client_event_id text,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (employee_id, type, occurred_at, client_event_id)
);

create unique index if not exists device_events_client_event_idx
  on public.device_events (employee_id, client_event_id)
  where client_event_id is not null;

create index if not exists device_events_company_occurred_idx
  on public.device_events (company_id, occurred_at desc);

create index if not exists device_events_employee_type_idx
  on public.device_events (employee_id, type, occurred_at desc);

create index if not exists device_events_day_idx
  on public.device_events (company_id, occurred_at)
  where occurred_at > now() - interval '90 days';

create table if not exists public.violations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  employee_id uuid not null references public.employees (id) on delete cascade,

  type text not null,
  category text not null default 'general',
  severity text not null default 'high' check (severity in ('critical', 'high', 'medium')),
  occurred_at timestamptz not null default now(),
  status text not null default 'open' check (status in ('open', 'acknowledged', 'resolved')),
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists violations_company_occurred_idx
  on public.violations (company_id, occurred_at desc);
create index if not exists violations_employee_idx
  on public.violations (employee_id, occurred_at desc);

-- ---------------------------------------------------------------------------
-- RLS — device + violation data is the most sensitive material in the product
-- (it can imply a worker is cheating). Admin/viewer only; an employee never
-- reads raw device_events.
-- ---------------------------------------------------------------------------
alter table public.device_profiles enable row level security;
alter table public.device_events enable row level security;
alter table public.violations enable row level security;

drop policy if exists device_profiles_select on public.device_profiles;
create policy device_profiles_select on public.device_profiles
  for select using (public.current_role() in ('admin', 'viewer'));

drop policy if exists device_profiles_write on public.device_profiles;
create policy device_profiles_write on public.device_profiles
  for insert with check (true);
drop policy if exists device_profiles_update on public.device_profiles;
create policy device_profiles_update on public.device_profiles
  for update using (true) with check (true);

drop policy if exists device_events_select on public.device_events;
create policy device_events_select on public.device_events
  for select using (public.current_role() in ('admin', 'viewer'));

drop policy if exists device_events_insert on public.device_events;
create policy device_events_insert on public.device_events
  for insert with check (true);

drop policy if exists violations_select on public.violations;
create policy violations_select on public.violations
  for select using (
    public.current_role() in ('admin', 'viewer') or public.is_my_employee(employee_id)
  );

drop policy if exists violations_insert on public.violations;
create policy violations_insert on public.violations
  for insert with check (true);

drop policy if exists violations_update on public.violations;
create policy violations_update on public.violations
  for update using (public.is_company_admin()) with check (public.is_company_admin());

grant select on table public.device_profiles, public.device_events, public.violations
  to anon, authenticated, service_role;
grant insert on table public.device_profiles, public.device_events, public.violations
  to authenticated, service_role;
grant update on table public.device_profiles, public.violations to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Realtime: the dashboard and Command Center subscribe to live signals.
-- ---------------------------------------------------------------------------
do $$
begin
  begin
    alter publication supabase_realtime add table public.device_events;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.violations;
  exception when duplicate_object then null;
  end;
end $$;