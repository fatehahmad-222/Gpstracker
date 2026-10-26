alter table public.device_profiles
  add column if not exists install_id text;

alter table public.device_tokens
  add column if not exists reenroll_allowed boolean not null default false;

alter table public.api_usage_counters
  drop constraint if exists api_usage_counters_kind_check;

alter table public.api_usage_counters
  add constraint api_usage_counters_kind_check
  check (kind in ('search', 'map_action', 'keystroke', 'map_pin', 'device_ingest', 'device_enroll'));

create table if not exists public.push_tokens (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  employee_id uuid references public.employees (id) on delete cascade,
  device_id text,
  token text not null,
  platform text not null default 'android' check (platform in ('android', 'ios')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_used_at timestamptz,
  disabled_at timestamptz,
  unique (token),
  check (char_length(token) between 20 and 512)
);

create index if not exists push_tokens_profile_idx
  on public.push_tokens (profile_id)
  where disabled_at is null;

create index if not exists push_tokens_company_idx
  on public.push_tokens (company_id);

create table if not exists public.push_outbox (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  recipient_profile_id uuid not null references public.profiles (id) on delete cascade,
  title text not null,
  body text not null,
  data jsonb not null default '{}'::jsonb,
  dedupe_key text,
  status text not null default 'pending'
    check (status in ('pending', 'sent', 'failed', 'skipped')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  locked_at timestamptz,
  sent_at timestamptz,
  last_error text,
  created_at timestamptz not null default now()
);

create unique index if not exists push_outbox_dedupe_idx
  on public.push_outbox (dedupe_key)
  where dedupe_key is not null;

create index if not exists push_outbox_pending_idx
  on public.push_outbox (next_attempt_at)
  where status = 'pending';

create index if not exists push_outbox_recipient_idx
  on public.push_outbox (recipient_profile_id, created_at desc);

alter table public.push_tokens enable row level security;
alter table public.push_outbox enable row level security;

revoke all on table public.push_outbox from authenticated;

drop policy if exists push_tokens_select on public.push_tokens;
create policy push_tokens_select on public.push_tokens
  for select to authenticated
  using (profile_id = auth.uid() and public.same_company(company_id));

grant select on table public.push_tokens to authenticated;
grant all on table public.push_tokens, public.push_outbox to service_role;

create or replace function public.enqueue_push(
  p_company_id uuid,
  p_recipient_profile_id uuid,
  p_title text,
  p_body text,
  p_data jsonb default '{}'::jsonb,
  p_dedupe_key text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if p_recipient_profile_id is null then
    return null;
  end if;

  if not exists (
    select 1
    from public.profiles
    where id = p_recipient_profile_id
      and company_id = p_company_id
      and coalesce(is_active, true)
  ) then
    return null;
  end if;

  insert into public.push_outbox (
    company_id,
    recipient_profile_id,
    title,
    body,
    data,
    dedupe_key
  )
  values (
    p_company_id,
    p_recipient_profile_id,
    left(coalesce(p_title, ''), 120),
    left(coalesce(p_body, ''), 500),
    coalesce(p_data, '{}'::jsonb),
    p_dedupe_key
  )
  on conflict do nothing
  returning id into v_id;

  return v_id;
end;
$$;

revoke execute on function public.enqueue_push(uuid, uuid, text, text, jsonb, text) from public;
grant execute on function public.enqueue_push(uuid, uuid, text, text, jsonb, text) to service_role;

create or replace function public.enqueue_push_to_admins(
  p_company_id uuid,
  p_title text,
  p_body text,
  p_data jsonb default '{}'::jsonb,
  p_dedupe_prefix text default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile_id uuid;
  v_count integer := 0;
begin
  for v_profile_id in
    select id
    from public.profiles
    where company_id = p_company_id
      and role = 'admin'
      and coalesce(is_active, true)
  loop
    perform public.enqueue_push(
      p_company_id,
      v_profile_id,
      p_title,
      p_body,
      p_data,
      case
        when p_dedupe_prefix is null then null
        else p_dedupe_prefix || ':' || v_profile_id::text
      end
    );
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke execute on function public.enqueue_push_to_admins(uuid, text, text, jsonb, text) from public;
grant execute on function public.enqueue_push_to_admins(uuid, text, text, jsonb, text) to service_role;

create or replace function public.claim_push_outbox(p_limit integer default 100)
returns table (
  id uuid,
  company_id uuid,
  recipient_profile_id uuid,
  title text,
  body text,
  data jsonb,
  attempts integer
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with claimed as (
    select o.id
    from public.push_outbox o
    where o.status = 'pending'
      and o.next_attempt_at <= now()
      and (o.locked_at is null or o.locked_at < now() - interval '10 minutes')
    order by o.next_attempt_at, o.created_at
    for update skip locked
    limit greatest(1, least(coalesce(p_limit, 100), 500))
  )
  update public.push_outbox o
  set
    locked_at = now(),
    attempts = o.attempts + 1
  from claimed c
  where o.id = c.id
  returning o.id, o.company_id, o.recipient_profile_id, o.title, o.body, o.data, o.attempts;
end;
$$;

revoke execute on function public.claim_push_outbox(integer) from public;
grant execute on function public.claim_push_outbox(integer) to service_role;

create or replace function public.notify_task_assigned()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if NEW.employee_id is not null and NEW.employee_id is distinct from NEW.admin_id then
    perform public.enqueue_push(
      NEW.company_id,
      NEW.employee_id,
      'New task assigned',
      NEW.title,
      jsonb_build_object('type', 'task_assigned', 'task_id', NEW.id),
      'task_assigned:' || NEW.id::text
    );
  end if;

  return NEW;
end;
$$;

revoke execute on function public.notify_task_assigned() from public;

drop trigger if exists tasks_notify_assigned on public.tasks;
create trigger tasks_notify_assigned
after insert on public.tasks
for each row execute function public.notify_task_assigned();

create or replace function public.notify_task_completed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if NEW.status = 'completed'
    and OLD.status is distinct from NEW.status
    and NEW.admin_id is not null
    and NEW.admin_id is distinct from NEW.employee_id
  then
    perform public.enqueue_push(
      NEW.company_id,
      NEW.admin_id,
      'Task completed',
      NEW.title,
      jsonb_build_object('type', 'task_completed', 'task_id', NEW.id),
      'task_completed:' || NEW.id::text
    );
  end if;

  return NEW;
end;
$$;

revoke execute on function public.notify_task_completed() from public;

drop trigger if exists tasks_notify_completed on public.tasks;
create trigger tasks_notify_completed
after update of status on public.tasks
for each row execute function public.notify_task_completed();

create or replace function public.notify_leave_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
  v_profile_id uuid;
begin
  if NEW.status <> 'pending' then
    return NEW;
  end if;

  select name, profile_id
  into v_name, v_profile_id
  from public.employees
  where id = NEW.employee_id
    and company_id = NEW.company_id;

  perform public.enqueue_push_to_admins(
    NEW.company_id,
    'Leave request',
    coalesce(v_name, 'An employee') || ' requested ' || coalesce(NEW.leave_type, 'leave'),
    jsonb_build_object(
      'type', 'leave_requested',
      'leave_id', NEW.id,
      'employee_id', NEW.employee_id
    ),
    'leave_created:' || NEW.id::text
  );

  return NEW;
end;
$$;

revoke execute on function public.notify_leave_created() from public;

drop trigger if exists leaves_notify_created on public.leaves;
create trigger leaves_notify_created
after insert on public.leaves
for each row execute function public.notify_leave_created();

create or replace function public.notify_leave_decided()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile_id uuid;
begin
  if NEW.status = OLD.status or NEW.status not in ('approved', 'rejected') then
    return NEW;
  end if;

  select profile_id
  into v_profile_id
  from public.employees
  where id = NEW.employee_id
    and company_id = NEW.company_id;

  if v_profile_id is not null then
    perform public.enqueue_push(
      NEW.company_id,
      v_profile_id,
      case when NEW.status = 'approved' then 'Leave approved' else 'Leave rejected' end,
      coalesce(NEW.leave_type, 'Your leave') || ' request for ' || NEW.from_date::text || ' was ' || NEW.status,
      jsonb_build_object(
        'type', 'leave_decided',
        'leave_id', NEW.id,
        'status', NEW.status
      ),
      'leave_decided:' || NEW.id::text || ':' || NEW.status
    );
  end if;

  return NEW;
end;
$$;

revoke execute on function public.notify_leave_decided() from public;

drop trigger if exists leaves_notify_decided on public.leaves;
create trigger leaves_notify_decided
after update of status on public.leaves
for each row execute function public.notify_leave_decided();

create or replace function public.notify_critical_violation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if NEW.severity in ('critical', 'high') then
    perform public.enqueue_push_to_admins(
      NEW.company_id,
      case when NEW.severity = 'critical' then 'Critical alert' else 'High alert' end,
      NEW.type,
      jsonb_build_object(
        'type', 'violation',
        'violation_id', NEW.id,
        'severity', NEW.severity,
        'employee_id', NEW.employee_id
      ),
      'violation:' || NEW.id::text
    );
  end if;

  return NEW;
end;
$$;

revoke execute on function public.notify_critical_violation() from public;

drop trigger if exists violations_notify_critical on public.violations;
create trigger violations_notify_critical
after insert on public.violations
for each row execute function public.notify_critical_violation();

notify pgrst, 'reload schema';
