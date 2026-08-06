-- ============================================================================
-- Fleet Console — employee management (admin add / soft-delete)
-- Idempotent: safe to re-run. Adds the profiles.is_active flag so an admin
-- can deactivate (soft-delete) an employee without destroying the audit trail
-- of locations/tasks, plus the admin-update RLS policy and profiles realtime.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. profiles.is_active — soft-delete flag
-- ---------------------------------------------------------------------------
alter table public.profiles add column if not exists is_active boolean not null default true;

create index if not exists profiles_role_active_idx
  on public.profiles (role, is_active);

-- ---------------------------------------------------------------------------
-- 2. handle_new_user — also copy phone from user metadata so admin-created
--    accounts (auth.admin.createUser) get their phone on the profile row.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, phone)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    nullif(new.raw_user_meta_data ->> 'phone', '')
  );
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. RLS: admins may update any profile (deactivate / restore / phone etc.)
-- ---------------------------------------------------------------------------
drop policy if exists "profiles_update_admin" on public.profiles;
create policy "profiles_update_admin" on public.profiles
  for update
  using (public.is_admin())
  with check (public.is_admin());

-- Employees may still edit their own profile, but can never change their role
-- nor deactivate themselves (is_active must stay true on the resulting row).
drop policy if exists "profiles_update" on public.profiles;
create policy "profiles_update" on public.profiles
  for update
  using (id = auth.uid())
  with check (id = auth.uid() and role = 'employee' and is_active = true);

-- ---------------------------------------------------------------------------
-- 4. Realtime: publish profiles so the admin overview reflects adds, edits
--    and deactivations without a manual refetch.
-- ---------------------------------------------------------------------------
do $$
begin
  begin
    alter publication supabase_realtime add table public.profiles;
  exception when duplicate_object then null;
  end;
end $$;
