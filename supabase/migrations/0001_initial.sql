-- ============================================================================
-- Fleet Console — initial schema
-- Idempotent: safe to re-run. Tables/policies/functions are created with
-- "if not exists" / drop-if-exists guards.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. profiles — one row per auth.users row
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default '',
  role text not null default 'employee' check (role in ('admin', 'employee')),
  phone text,
  avatar_url text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 2. locations — append-only GPS history
-- ---------------------------------------------------------------------------
create table if not exists public.locations (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.profiles (id) on delete cascade,
  lat double precision not null,
  lng double precision not null,
  accuracy double precision,
  speed double precision,
  heading double precision,
  recorded_at timestamptz not null default now()
);

create index if not exists locations_employee_recorded_idx
  on public.locations (employee_id, recorded_at desc);

-- ---------------------------------------------------------------------------
-- 3. live_locations — one "latest position" row per employee,
--    maintained automatically by a trigger on locations insert.
-- ---------------------------------------------------------------------------
create table if not exists public.live_locations (
  employee_id uuid primary key references public.profiles (id) on delete cascade,
  lat double precision not null,
  lng double precision not null,
  accuracy double precision,
  speed double precision,
  heading double precision,
  recorded_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 4. tasks
-- ---------------------------------------------------------------------------
create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid references public.profiles (id) on delete set null,
  employee_id uuid not null references public.profiles (id) on delete cascade,
  title text not null,
  description text not null default '',
  target_lat double precision not null,
  target_lng double precision not null,
  target_address text,
  radius_meters numeric not null default 100 check (radius_meters >= 0),
  status text not null default 'pending' check (status in ('pending', 'in_progress', 'completed', 'cancelled')),
  completion_source text check (completion_source in ('geofence', 'manual')),
  due_at timestamptz,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists tasks_employee_status_idx
  on public.tasks (employee_id, status);

create index if not exists tasks_open_idx
  on public.tasks (employee_id)
  where status in ('pending', 'in_progress');

-- ---------------------------------------------------------------------------
-- 5. Security-definer helpers (avoid RLS recursion in policies)
-- ---------------------------------------------------------------------------
create or replace function public.is_admin()
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

-- ---------------------------------------------------------------------------
-- 6. Trigger: create a profiles row when a user signs up (role = employee)
--    Chosen over an API-route approach: it runs inside the database on every
--    auth.users insert, so it cannot be bypassed by an edited/broken client
--    and there is no race between signup and profile creation.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', '')
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- 7. Trigger: on every location insert —
--      a) upsert the employee's live_locations row
--      b) auto-complete any open task whose geofence the fix falls inside
--    Security definer so the trigger can write live_locations/tasks even
--    though app users have no UPDATE rights on those tables.
-- ---------------------------------------------------------------------------
create or replace function public.handle_location_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.live_locations
    (employee_id, lat, lng, accuracy, speed, heading, recorded_at)
  values
    (new.employee_id, new.lat, new.lng, new.accuracy, new.speed, new.heading, new.recorded_at)
  on conflict (employee_id)
  do update set
    lat = excluded.lat,
    lng = excluded.lng,
    accuracy = excluded.accuracy,
    speed = excluded.speed,
    heading = excluded.heading,
    recorded_at = excluded.recorded_at;

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

drop trigger if exists locations_after_insert on public.locations;
create trigger locations_after_insert
  after insert on public.locations
  for each row execute function public.handle_location_insert();

-- ---------------------------------------------------------------------------
-- 8. RPC: employee "start" a task (pending -> in_progress only)
--    Implemented as a guarded security-definer function so employees can
--    transition status without ever being able to update other columns
--    (e.g. tampering with target coordinates to spoof a geofence hit).
-- ---------------------------------------------------------------------------
create or replace function public.start_task(p_task_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.tasks
     set status = 'in_progress'
   where id = p_task_id
     and employee_id = auth.uid()
     and status = 'pending';
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. Row Level Security
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.locations enable row level security;
alter table public.live_locations enable row level security;
alter table public.tasks enable row level security;

-- profiles ---------------------------------------------------------------
drop policy if exists "profiles_select" on public.profiles;
create policy "profiles_select" on public.profiles
  for select
  using (public.is_admin() or id = auth.uid());

drop policy if exists "profiles_insert" on public.profiles;
create policy "profiles_insert" on public.profiles
  for insert
  with check (id = auth.uid() and role = 'employee');

drop policy if exists "profiles_update" on public.profiles;
create policy "profiles_update" on public.profiles
  for update
  using (id = auth.uid())
  with check (id = auth.uid() and role = 'employee');

-- locations (append-only: intentionally NO update/delete policies) --------
drop policy if exists "locations_select" on public.locations;
create policy "locations_select" on public.locations
  for select
  using (public.is_admin() or employee_id = auth.uid());

drop policy if exists "locations_insert" on public.locations;
create policy "locations_insert" on public.locations
  for insert
  with check (employee_id = auth.uid());

-- live_locations (writes happen only inside the security-definer trigger) --
drop policy if exists "live_locations_select" on public.live_locations;
create policy "live_locations_select" on public.live_locations
  for select
  using (public.is_admin() or employee_id = auth.uid());

-- tasks ------------------------------------------------------------------
drop policy if exists "tasks_select" on public.tasks;
create policy "tasks_select" on public.tasks
  for select
  using (public.is_admin() or employee_id = auth.uid());

drop policy if exists "tasks_insert" on public.tasks;
create policy "tasks_insert" on public.tasks
  for insert
  with check (public.is_admin());

drop policy if exists "tasks_update_admin" on public.tasks;
create policy "tasks_update_admin" on public.tasks
  for update
  using (public.is_admin())
  with check (public.is_admin());

-- No employee UPDATE policy: employees change task state only via
-- public.start_task(), never by direct update.

-- ---------------------------------------------------------------------------
-- 10. Grants
-- ---------------------------------------------------------------------------
grant usage on schema public to anon, authenticated, service_role;

grant select on table public.profiles to anon, authenticated, service_role;
grant insert, update on table public.profiles to authenticated, service_role;
grant select, insert on table public.locations to authenticated, service_role;
grant select on table public.live_locations to authenticated, service_role;
grant select, insert, update on table public.tasks to authenticated, service_role;

revoke execute on function public.handle_new_user() from public;
revoke execute on function public.handle_location_insert() from public;
revoke execute on function public.start_task(uuid) from public;
grant execute on function public.is_admin() to anon, authenticated, service_role;
grant execute on function public.start_task(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 11. Realtime publications
-- ---------------------------------------------------------------------------
do $$
begin
  begin
    alter publication supabase_realtime add table public.locations;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.live_locations;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.tasks;
  exception when duplicate_object then null;
  end;
end $$;
