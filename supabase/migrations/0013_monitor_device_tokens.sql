-- ============================================================================
-- 0013 - GPS Work Force Monitor: device tokens for telemetry ingestion
-- ----------------------------------------------------------------------------
-- Every screen in this module reads tables that only a phone can fill. Until
-- this migration existed there was no way for a device to write anything: the
-- seed script was the only writer of `device_events`, so in production the
-- dashboard, the alerts queue and the attendance pages would all have been
-- permanently empty.
--
-- Devices cannot authenticate the way users do. There is no Supabase session
-- for a background service on a phone that may be locked, offline or
-- force-stopped, and the monitor tables are RLS-locked to admin/viewer precisely
-- because an employee must never read raw device_events about themselves.
--
-- So devices get their own credential: a long opaque random string, presented as
-- a bearer token, which the phone stores and replays.
--
-- ONLY THE HASH IS STORED. The same rule as employee passwords, for the same
-- reason: this table is reachable by anything that can read the database, and a
-- leaked hash that can be replayed against this endpoint is a leaked credential.
-- Lookup happens by hash from the application, so no SQL function needs to do
-- any hashing and pgcrypto is not required.
-- ============================================================================

create table if not exists public.device_tokens (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,

  -- The token identifies exactly one employee on exactly one handset. Scoping it
  -- to both is what lets the ingest endpoint trust `employee_id` from the token
  -- instead of from the request body.
  employee_id uuid not null references public.employees (id) on delete cascade,
  device_id text not null,

  -- sha256 hex of the bearer token. Never the token itself.
  token_hash text not null,
  label text,

  last_used_at timestamptz,
  revoked_at timestamptz,
  expires_at timestamptz,

  created_at timestamptz not null default now(),
  unique (token_hash),
  unique (employee_id, device_id)
);

-- The hot path is a lookup by hash on every single ingest request, which the
-- `unique (token_hash)` constraint above already serves as a btree index. No
-- second index here: `create unique index device_tokens_hash_idx` on the same
-- column would be a duplicate of the constraint's index, costing write
-- throughput and disk for nothing.

-- "Show me every device enrolled for this employee" - used when revoking a lost
-- phone without rotating every handset.
create index if not exists device_tokens_employee_idx on public.device_tokens (employee_id);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
-- Denied to every authenticated role on purpose. A user must never be able to
-- read this table, not even their own row: `token_hash` is a credential, and
-- "a user can read their own token hash" is enough to impersonate their device
-- to the ingest endpoint.
--
-- The ingest route reads this table with the service role and applies its own
-- authorisation. Admins manage tokens through app/api/monitor/device-tokens,
-- which is a session-authenticated route with its own checks.
-- ---------------------------------------------------------------------------
alter table public.device_tokens enable row level security;

-- No policies at all: RLS enabled with zero policies denies everything, which is
-- the correct state. Stated explicitly because an empty policy list reads like
-- an oversight to the next person who greps for "device_tokens".

-- ---------------------------------------------------------------------------
-- device_profiles already has `unique (employee_id, device_id)` from 0007, which
-- is the constraint ingestion needs for its heartbeat upsert, and the index that
-- constraint implies. No extra index is required here.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Grant the position RPC to the service role.
--
-- 0011 created `upsert_employee_position` and then revoked execute from PUBLIC,
-- but never granted it to anyone. Since PUBLIC held the default execute
-- privilege, that revoke left the function callable only by its owner - so
-- service_role could not call it, and nothing in the codebase could populate
-- `employee_positions`. The Live Map had a read path and no write path, and the
-- bug was invisible until there was a caller.
--
-- Re-stated here rather than editing 0011, because migrations already applied
-- must not be rewritten.
-- ---------------------------------------------------------------------------
grant execute on function public.upsert_employee_position(
  uuid, uuid, double precision, double precision, double precision,
  double precision, double precision, integer, timestamptz
) to service_role;

-- ---------------------------------------------------------------------------
-- Let `device_events` store low-severity rows.
--
-- 0007 constrained device_events.severity to ('critical','high','medium'), the
-- same set it used for violations. That conflated two different tables.
--
-- `violations` is the actionable queue: a supervisor has to be able to triage
-- it, so 'low' is correctly absent there and `RAISED_VIOLATION_TYPES` refuses to
-- raise one.
--
-- `device_events` is raw evidence, and it is the only record that a device ever
-- reported something. Three catalogue event types - admin_logout, old_app and
-- battery_low - are 'low', and they are exactly the ones worth keeping: a stale
-- app version or a dying battery is how a later absence gets explained. With the
-- constraint as written, ingesting any of those failed the whole batch with a
-- check violation, and seed.mjs could not insert them either. Severity is
-- derived from the catalogue server-side (lib/monitor/ingest.js), never from
-- the request, so widening the constraint does not let a device choose its own.
--
-- violations.severity is deliberately left alone.
-- ---------------------------------------------------------------------------
alter table public.device_events
  drop constraint if exists device_events_severity_check;

alter table public.device_events
  add constraint device_events_severity_check
  check (severity in ('critical', 'high', 'medium', 'low'));

-- ---------------------------------------------------------------------------
-- Make the idempotency keys usable by an upsert.
--
-- 0007 and 0009 both created *partial* unique indexes:
--
--   create unique index device_events_client_event_idx
--     on device_events (employee_id, client_event_id)
--     where client_event_id is not null;
--
-- PostgREST turns `on_conflict=employee_id,client_event_id` into
--
--   insert ... on conflict (employee_id, client_event_id) do nothing
--
-- and PostgreSQL can only infer that target against an index whose predicate is
-- also proven. PostgREST has no way to send the `where client_event_id is not
-- null` clause, so the statement dies with
--
--   ERROR: there is no unique or exclusion constraint matching
--          the ON CONFLICT specification
--
-- which means every retry-safe write in ingestBatch would have failed at runtime,
-- and a plain `.insert()` would not help either: one duplicate aborts the whole
-- batch, so a phone retrying 40 buffered events would lose all 40. The partial
-- indexes were correct SQL and an unusable interface.
--
-- A plain unique index is exactly equivalent here. PostgreSQL treats NULLs as
-- distinct in a unique index, so rows written by the old Fleet Console tracker
-- with a NULL client_event_id remain unconstrained, which is what the partial
-- index was doing for them anyway.
-- ---------------------------------------------------------------------------
drop index if exists public.device_events_client_event_idx;
create unique index if not exists device_events_client_event_key
  on public.device_events (employee_id, client_event_id);

drop index if exists public.locations_client_event_idx;
create unique index if not exists locations_client_event_key
  on public.locations (employee_id, client_event_id);