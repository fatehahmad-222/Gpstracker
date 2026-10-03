-- ============================================================================
-- 0008 — GPS Work Force Monitor: policies + presence checks
-- ----------------------------------------------------------------------------
-- Two policy types share one table and one engine:
--   late_early_deduction -> params: grace_minutes, method (fixed|per_minute|
--                           salary_based), amount, max_deduction,
--                           warn_after_occurrences
--   presence_check       -> params: selfie_grace_minutes, notifications
-- ============================================================================

create table if not exists public.policies (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,

  name text not null,
  type text not null check (type in ('late_early_deduction', 'presence_check')),
  description text,

  effective_from date not null default current_date,
  status text not null default 'active' check (status in ('active', 'inactive')),

  scope text not null default 'all' check (scope in ('all', 'department', 'employee')),
  scope_ref_id uuid,

  params jsonb not null default '{}'::jsonb,

  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists policies_company_idx on public.policies (company_id, type, status);

create table if not exists public.presence_checks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  policy_id uuid not null references public.policies (id) on delete cascade,
  employee_id uuid not null references public.employees (id) on delete cascade,

  sent_at timestamptz not null default now(),
  deadline_at timestamptz not null,
  selfie_url text,
  captured_at timestamptz,
  missed boolean not null default false,
  attempt integer not null default 1,
  created_at timestamptz not null default now()
);

create index if not exists presence_checks_pending_idx
  on public.presence_checks (company_id, deadline_at)
  where captured_at is null and missed = false;

create index if not exists presence_checks_employee_idx
  on public.presence_checks (employee_id, sent_at desc);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.policies enable row level security;
alter table public.presence_checks enable row level security;

drop policy if exists policies_select on public.policies;
create policy policies_select on public.policies
  for select using (public.same_company(company_id));

drop policy if exists policies_insert on public.policies;
create policy policies_insert on public.policies
  for insert with check (public.is_company_admin());

drop policy if exists policies_update on public.policies;
create policy policies_update on public.policies
  for update using (public.is_company_admin()) with check (public.is_company_admin());

drop policy if exists policies_delete on public.policies;
create policy policies_delete on public.policies
  for delete using (public.is_company_admin());

-- Selfies are biometric-adjacent: only the employee themself and staff may see.
drop policy if exists presence_checks_select on public.presence_checks;
create policy presence_checks_select on public.presence_checks
  for select using (
    public.current_role() in ('admin', 'viewer') or public.is_my_employee(employee_id)
  );

drop policy if exists presence_checks_insert on public.presence_checks;
create policy presence_checks_insert on public.presence_checks
  for insert with check (true);

drop policy if exists presence_checks_update on public.presence_checks;
create policy presence_checks_update on public.presence_checks
  for update using (true) with check (true);

grant select on table public.policies, public.presence_checks to anon, authenticated, service_role;
grant insert, update, delete on table public.policies to authenticated, service_role;
grant insert, update on table public.presence_checks to authenticated, service_role;