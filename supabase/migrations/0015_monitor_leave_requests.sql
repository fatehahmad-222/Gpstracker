-- ---------------------------------------------------------------------------
-- 0015_monitor_leave_requests.sql
--
-- Restore the ability to file a leave request.
--
-- 0014 dropped `leaves_insert` because it was `with check (true)` - any
-- authenticated user of any company could insert a request against any employee.
-- Dropping it was right, but it left the table read-and-approve-only: nobody
-- could file a request at all, including an admin acting on someone's behalf.
--
-- This adds a replacement that keeps the tenant boundary. Both branches resolve
-- the employee and the company to the caller, so neither can be pointed at
-- another tenant:
--
--   * an employee files their own request, or
--   * an admin files one for anyone inside their own company.
--
-- `is_my_employee()` and `same_company()` already exist from 0007/0010 and were
-- kept by 0014; only their `anon` execute grant was revoked there.
--
-- `leaves_update` is not touched. 0014 already restricted it to a company admin,
-- and the approve/reject *transition* is enforced in the route and in
-- lib/monitor/leaves.js, which refuses to move a request out of a decided state.
-- ---------------------------------------------------------------------------

drop policy if exists leaves_insert on public.leaves;

create policy leaves_insert on public.leaves
  for insert to authenticated
  with check (
    (public.is_my_employee(employee_id) and public.same_company(company_id))
    or public.is_company_admin_for(company_id)
  );

-- The queue is read as pending-first, then most recent.
create index if not exists leaves_status_from_idx
  on public.leaves (company_id, status, from_date desc);

-- One employee's history must not be blocked by another's, and an employee's
-- own list is scoped by employee_id rather than company.
create index if not exists leaves_employee_idx
  on public.leaves (employee_id, from_date desc);