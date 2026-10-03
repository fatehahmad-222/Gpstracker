-- ============================================================================
-- 0004 — GPS Work Force Monitor: organisation + HR records
-- ----------------------------------------------------------------------------
-- `profiles` stays the auth identity / role / tenant-membership table.
-- `employees` is the HR record, linked 1:1 to `profiles.profile_id`.
-- profile_id is nullable so seeded demo employees can exist without an
-- auth account (a phone-only worker has no portal login).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Organisation tree
-- ---------------------------------------------------------------------------
create table if not exists public.departments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  name text not null,
  code text,
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  unique (company_id, name)
);

create table if not exists public.sub_departments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  department_id uuid not null references public.departments (id) on delete cascade,
  name text not null,
  code text,
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  unique (company_id, department_id, name)
);

create table if not exists public.designations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  department_id uuid references public.departments (id) on delete cascade,
  sub_department_id uuid references public.sub_departments (id) on delete cascade,
  name text not null,
  code text,
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  unique (company_id, name)
);

create index if not exists departments_company_idx on public.departments (company_id, status);
create index if not exists sub_departments_company_idx on public.sub_departments (company_id, department_id);
create index if not exists designations_company_idx on public.designations (company_id, department_id);

-- ---------------------------------------------------------------------------
-- 2. employees — HR record (kept deliberately separate from `profiles`)
-- ---------------------------------------------------------------------------
create table if not exists public.employees (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  profile_id uuid references public.profiles (id) on delete set null,

  emp_code text not null,
  name text not null,
  father_husband_name text,

  dob date,
  gender text check (gender in ('male', 'female', 'other')),
  marital_status text check (marital_status in ('single', 'married', 'divorced', 'widowed')),
  cnic text,
  phone text,
  email text,
  address text,
  photo_url text,

  hire_date date,
  education text,
  department_id uuid references public.departments (id) on delete set null,
  designation_id uuid references public.designations (id) on delete set null,
  last_job_history text,

  -- Shift times stored as minutes-from-midnight so overnight shifts
  -- (21:00 -> 06:00) and 24h arithmetic are trivial. 1290 = 21:30.
  shift_start smallint not null default 540 check (shift_start between 0 and 1439),
  shift_end smallint not null default 1020 check (shift_end between 0 and 1439),

  basic_salary numeric(12, 2) not null default 0 check (basic_salary >= 0),
  payment_method text check (payment_method in ('bank', 'cash', 'cheque')),
  late_deduction boolean not null default false,
  overtime_allowed boolean not null default true,
  absent_deduction boolean not null default false,
  wht_tax boolean not null default false,

  app_password_hash text,
  geofencing_enabled boolean not null default true,
  attendance_source text not null default 'GPS APP',

  -- consent + retention flags for sensitive location tracking (spec 9.1)
  tracking_consent boolean not null default false,
  consent_at timestamptz,

  status text not null default 'active' check (status in ('active', 'inactive')),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, emp_code)
);

create index if not exists employees_company_status_idx on public.employees (company_id, status);
create index if not exists employees_company_dept_idx on public.employees (company_id, department_id);
create index if not exists employees_profile_idx on public.employees (profile_id);
create index if not exists employees_deleted_idx on public.employees (company_id, deleted_at)
  where deleted_at is not null;

-- ---------------------------------------------------------------------------
-- 3. Backfill an HR record for every existing profile so the current
--    Fleet Console employees show up in the monitor module immediately.
-- ---------------------------------------------------------------------------
insert into public.employees (company_id, profile_id, emp_code, name, phone, status)
select
  p.company_id,
  p.id,
  'LEG-' || substr(replace(p.id::text, '-', ''), 1, 6),
  coalesce(nullif(p.full_name, ''), 'Unnamed'),
  p.phone,
  case when p.is_active then 'active' else 'inactive' end
from public.profiles p
where p.role = 'employee'
on conflict (company_id, emp_code) do nothing;

-- ---------------------------------------------------------------------------
-- 4. audit_log — powers the "Deleted Logs" view and the 9.1 admin-action audit
-- ---------------------------------------------------------------------------
create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  actor_id uuid references public.profiles (id) on delete set null,
  actor_email text,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  summary text,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists audit_log_company_created_idx on public.audit_log (company_id, created_at desc);
create index if not exists audit_log_entity_idx on public.audit_log (entity_type, entity_id);

-- ---------------------------------------------------------------------------
-- 5. audit trigger helper (used from Phase 3+ mutations)
-- ---------------------------------------------------------------------------
create or replace function public.write_audit(
  p_action text,
  p_entity_type text,
  p_entity_id uuid,
  p_summary text default null,
  p_meta jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.audit_log
    (company_id, actor_id, actor_email, action, entity_type, entity_id, summary, meta)
  values (
    public.current_company_id(),
    auth.uid(),
    (select email from auth.users where id = auth.uid()),
    p_action,
    p_entity_type,
    p_entity_id,
    p_summary,
    p_meta
  );
end;
$$;

revoke execute on function public.write_audit(text, text, uuid, text, jsonb) from public;
grant execute on function public.write_audit(text, text, uuid, text, jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. Row Level Security
--    Every policy below calls a SECURITY DEFINER helper rather than querying
--    `employees` / `profiles` inline — an inline self-reference on `employees`
--    would re-enter its own policy and blow up with infinite recursion.
-- ---------------------------------------------------------------------------
create or replace function public.same_company(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_company_id is not null
    and p_company_id = public.current_company_id();
$$;

create or replace function public.is_my_employee(p_employee_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.employees e
    where e.id = p_employee_id and e.profile_id = auth.uid()
  );
$$;

revoke execute on function public.same_company(uuid) from public;
revoke execute on function public.is_my_employee(uuid) from public;
grant execute on function public.same_company(uuid) to anon, authenticated, service_role;
grant execute on function public.is_my_employee(uuid) to anon, authenticated, service_role;

alter table public.departments enable row level security;
alter table public.sub_departments enable row level security;
alter table public.designations enable row level security;
alter table public.employees enable row level security;
alter table public.audit_log enable row level security;

-- Organisation tree: readable by anyone in the company (an employee needs to
-- resolve their own department/designation name), writable by admins only.
do $$
declare
  t text;
begin
  foreach t in array array['departments', 'sub_departments', 'designations']
  loop
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('create policy %I on public.%I for select using (public.same_company(company_id))',
      t || '_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format('create policy %I on public.%I for insert with check (public.is_company_admin())',
      t || '_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format('create policy %I on public.%I for update using (public.is_company_admin()) with check (public.is_company_admin())',
      t || '_update', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete', t);
    execute format('create policy %I on public.%I for delete using (public.is_company_admin())',
      t || '_delete', t);
  end loop;
end $$;

-- employees: admin/viewer see the whole company; an employee sees only self.
drop policy if exists employees_select on public.employees;
create policy employees_select on public.employees
  for select
  using (public.current_role() in ('admin', 'viewer') or public.is_my_employee(id));

drop policy if exists employees_insert on public.employees;
create policy employees_insert on public.employees
  for insert with check (public.is_company_admin());

drop policy if exists employees_update on public.employees;
create policy employees_update on public.employees
  for update using (public.is_company_admin()) with check (public.is_company_admin());

-- No DELETE policy on employees on purpose: soft-delete via deleted_at
-- preserves the location/attendance audit trail (spec 4.3).

-- audit_log: admin/viewer only. It records actor emails and admin actions,
-- so employees must not be able to read it.
drop policy if exists audit_log_select on public.audit_log;
create policy audit_log_select on public.audit_log
  for select
  using (public.current_role() in ('admin', 'viewer'));

-- audit_log is append-only: no update/delete policies on purpose.
drop policy if exists audit_log_update on public.audit_log;
drop policy if exists audit_log_delete on public.audit_log;
drop policy if exists audit_log_insert on public.audit_log;
create policy audit_log_insert on public.audit_log
  for insert with check (public.is_company_admin());

-- ---------------------------------------------------------------------------
-- 7. grants
-- ---------------------------------------------------------------------------
grant select on table public.departments, public.sub_departments, public.designations,
  public.employees, public.audit_log to anon, authenticated, service_role;
grant insert, update on table public.departments, public.sub_departments, public.designations,
  public.employees to authenticated, service_role;
grant insert on table public.audit_log to authenticated, service_role;