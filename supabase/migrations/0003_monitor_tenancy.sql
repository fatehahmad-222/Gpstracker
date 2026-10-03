-- ============================================================================
-- 0003 — GPS Work Force Monitor: tenancy + roles
-- ----------------------------------------------------------------------------
-- Additive only. Every existing table, function and policy is left in place so
-- the current Fleet Console features (dashboard, tasks, employee maps) keep
-- working untouched. We only:
--   1. add `companies`
--   2. add `company_id` to profiles / locations / live_locations / tasks
--   3. widen the profiles.role CHECK from 2 roles to 3 (adds `viewer`)
--   4. backfill every existing row to a seeded default company
--   5. add company-scoped SECURITY DEFINER helpers for the new RLS policies
--
-- Idempotent: safe to re-run.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. companies
-- ---------------------------------------------------------------------------
create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  company_code text not null unique,
  timezone text not null default 'Asia/Karachi',
  settings jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

comment on column public.companies.settings is
  'min_android_version, refresh_interval_ms, map quotas, risk weights, retention_days';

-- Deterministic id so re-runs and backfills stay idempotent.
insert into public.companies (id, name, company_code, timezone, settings)
values (
  'c0000000-0000-4000-8000-000000000001',
  'MetaXperts (Pvt) Ltd',
  'PK-PUN-SKT-MX05',
  'Asia/Karachi',
  '{
    "min_android_version": 14,
    "refresh_interval_ms": 30000,
    "retention_days": 90,
    "late_grace_minutes": 15,
    "map_quotas": {
      "search": 200,
      "map_action": 25,
      "keystroke": 100,
      "map_pin": 200
    },
    "risk_weights": {
      "unsupported": 5,
      "force_stop": 4,
      "auto_clock_out": 1.5,
      "second_device": 4,
      "data_cleared": 8,
      "logged_in_not_synced": 8,
      "fake_gps": 10,
      "impossible_travel": 9,
      "out_of_zone": 3,
      "heartbeat_gap": 2,
      "no_clock_in": 1,
      "auto_time_off": 4,
      "time_diff": 3,
      "location_off": 2,
      "power_off": 2,
      "battery_restrict": 2,
      "dead_zone": 1,
      "developer_mode": 3,
      "logged_out": 2,
      "admin_logout": 1,
      "sim_change": 5,
      "old_app": 1,
      "battery_low": 1
    }
  }'::jsonb
)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 2. profiles: company_id + granular permissions
-- ---------------------------------------------------------------------------
alter table public.profiles add column if not exists company_id uuid references public.companies (id) on delete restrict;
alter table public.profiles add column if not exists permissions jsonb not null default '{}'::jsonb;

update public.profiles
set company_id = 'c0000000-0000-4000-8000-000000000001'
where company_id is null;

alter table public.profiles alter column company_id set default 'c0000000-0000-4000-8000-000000000001';
alter table public.profiles alter column company_id set not null;

create index if not exists profiles_company_idx on public.profiles (company_id);

-- ---------------------------------------------------------------------------
-- 3. Widen role CHECK: admin | employee -> admin | viewer | employee
--    Drop whatever name Postgres auto-assigned, then re-add the wider set.
-- ---------------------------------------------------------------------------
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles drop constraint if exists profiles_role_name_check;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and conname = 'profiles_role_check'
  ) then
    alter table public.profiles
      add constraint profiles_role_check check (role in ('admin', 'viewer', 'employee'));
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4. locations / live_locations / tasks: company_id
--    `locations` is deliberately extended in place rather than adding a
--    separate `location_pings` table — the existing trigger, Realtime
--    publication, indexes and HistoryMap consumers all read `locations`.
-- ---------------------------------------------------------------------------
alter table public.locations add column if not exists company_id uuid references public.companies (id) on delete restrict;
alter table public.live_locations add column if not exists company_id uuid references public.companies (id) on delete restrict;
alter table public.tasks add column if not exists company_id uuid references public.companies (id) on delete restrict;

update public.locations set company_id = 'c0000000-0000-4000-8000-000000000001' where company_id is null;
update public.live_locations set company_id = 'c0000000-0000-4000-8000-000000000001' where company_id is null;
update public.tasks set company_id = 'c0000000-0000-4000-8000-000000000001' where company_id is null;

alter table public.locations alter column company_id set default 'c0000000-0000-4000-8000-000000000001';
alter table public.live_locations alter column company_id set default 'c0000000-0000-4000-8000-000000000001';
alter table public.tasks alter column company_id set default 'c0000000-0000-4000-8000-000000000001';

alter table public.locations alter column company_id set not null;
alter table public.live_locations alter column company_id set not null;
alter table public.tasks alter column company_id set not null;

create index if not exists locations_company_recorded_idx on public.locations (company_id, recorded_at desc);
create index if not exists tasks_company_status_idx on public.tasks (company_id, status);

-- ---------------------------------------------------------------------------
-- 5. handle_new_user — carry company_id (and role for invited staff) through
--    from signup metadata so the NOT NULL column above cannot break signup.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid;
  v_role text;
begin
  v_company := nullif(new.raw_user_meta_data ->> 'company_id', '')::uuid;
  if v_company is null then
    v_company := 'c0000000-0000-4000-8000-000000000001'::uuid;
  end if;

  -- Never let a public signup self-assign a privileged role.
  v_role := case new.raw_user_meta_data ->> 'role'
    when 'admin' then 'admin'
    when 'viewer' then 'viewer'
    else 'employee'
  end;

  insert into public.profiles (id, full_name, phone, role, company_id)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    nullif(new.raw_user_meta_data ->> 'phone', ''),
    v_role,
    v_company
  );
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Company-scoped helpers for the monitor module's RLS policies.
--    SECURITY DEFINER + fixed search_path so a policy on `employees` can ask
--    "who is my company?" without recursing through profiles policies.
-- ---------------------------------------------------------------------------
create or replace function public.current_company_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select company_id from public.profiles where id = auth.uid();
$$;

create or replace function public.current_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid();
$$;

create or replace function public.is_company_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

/** Admin = write. Viewer = read-only. Employee = own rows only. */
create or replace function public.can_company_write()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('admin', 'viewer')
  );
$$;

-- ---------------------------------------------------------------------------
-- 7. grants
-- ---------------------------------------------------------------------------
grant select on table public.companies to anon, authenticated, service_role;
grant select on table public.profiles to anon, authenticated, service_role;
grant insert, update on table public.profiles to authenticated, service_role;

grant execute on function public.current_company_id() to anon, authenticated, service_role;
grant execute on function public.current_role() to anon, authenticated, service_role;
grant execute on function public.is_company_admin() to anon, authenticated, service_role;
grant execute on function public.can_company_write() to anon, authenticated, service_role;