-- ============================================================================
-- 0016 - GPS Work Force Monitor: take the anon role off the tables
-- ----------------------------------------------------------------------------
-- Found by finally running the schema against the real project instead of only
-- reading it, which is the argument for the regression test at the end.
--
-- 0014 audited every policy and concluded, correctly, that the tables had "no
-- grants to anon". That conclusion was wrong, and it was wrong for a reason no
-- amount of reading these files could have revealed: it was never a property of
-- these files. Supabase configures
--
--   alter default privileges for role postgres in schema public
--     grant all on tables to anon, authenticated, service_role;
--
-- so *every* table created by these migrations inherited full INSERT, SELECT,
-- UPDATE, DELETE, TRUNCATE, REFERENCES and TRIGGER from anon, and the explicit
-- `grant select ... to anon` lines in 0004, 0005, 0007, 0008 and 0010 were
-- redundant with a grant that was already there.
--
-- The live result, measured as the anon role rather than inferred:
--
--   anon: sel=Y ins=Y upd=Y del=Y on locations, audit_log, violations,
--         employees, device_tokens, device_events, ... i.e. all 23 tables.
--
-- Nothing was exploitable *today* - RLS is enabled on all 23 tables and every
-- policy is company-scoped, so an anonymous write updated zero rows and an
-- anonymous read returned zero rows. That is one policy mistake away from a
-- public dump of every worker's GPS history, which is why it is being closed now
-- rather than filed: the grants were the only layer between the internet and the
-- data, and it was a single `with check (true)` away from being no layer at all.
--
-- It also produced a genuinely confusing failure mode. 0014 revoked execute on
-- current_role(), same_company() and is_my_employee() from anon, on the reasoning
-- that an anonymous request would be refused at the table first. Because the table
-- grant was still there, the request instead reached the policy and died with
--
--   ERROR: permission denied for function current_role
--
-- on a read that should have been an empty result. The hardened helper is still
-- worth keeping; it just needed the grants to go with it.
--
-- Nothing here changes intended behaviour. anon is what PostgREST uses before
-- sign-in, and it has no legitimate reason to read or write a business table: the
-- app's session client runs as `authenticated`, and the ingestion and
-- device-token paths run as `service_role`, which bypasses RLS. `usage on schema
-- public` is deliberately left in place so that a refusal arrives as
-- "permission denied for table X" - naming the table - rather than as an opaque
-- schema error.
-- ============================================================================

-- 1. The tables. All 23, whatever state the replayed migrations left them in.
revoke all on all tables in schema public from anon;

-- 2. Sequences. Unreachable once the tables are, but a sequence is a standalone
--    object and leaving it granted means the next person to expose a table is
--    surprised twice.
revoke all on all sequences in schema public from anon;

-- 3. Functions. Every public function here is either an RLS helper - whose whole
--    answer is a boolean about the caller, which is null for an anonymous caller -
--    or a SECURITY DEFINER job that acts on behalf of the service role. Neither
--    is something anon should be able to invoke directly, and 0014 already began
--    this list.
revoke all on all functions in schema public from anon;

-- ---------------------------------------------------------------------------
-- 4. Stop it coming back
-- ---------------------------------------------------------------------------
-- Revoking the grant on today's tables is only half the job: the default
-- privileges are what put it there, and the next table anyone adds would inherit
-- it again. These are the lines that actually fix the class of bug.
--
-- Wrapped individually because altering another role's default privileges
-- requires membership in that role, and on a hosted project the pooler login may
-- or may not be a member of postgres or supabase_admin. Failing the migration
-- half-way through would be worse than skipping a defence-in-depth line, so each
-- one degrades to a notice instead of an error.
do $$
begin
  begin
    execute 'alter default privileges for role postgres in schema public revoke all on tables from anon';
  exception when insufficient_privilege then
    raise notice '0016: cannot alter default privileges for role postgres (tables)';
  end;

  begin
    execute 'alter default privileges for role postgres in schema public revoke all on sequences from anon';
  exception when insufficient_privilege then
    raise notice '0016: cannot alter default privileges for role postgres (sequences)';
  end;

  begin
    execute 'alter default privileges for role postgres in schema public revoke execute on functions from anon';
  exception when insufficient_privilege then
    raise notice '0016: cannot alter default privileges for role postgres (functions)';
  end;

  begin
    execute 'alter default privileges for role supabase_admin in schema public revoke all on tables from anon';
  exception when insufficient_privilege then
    raise notice '0016: cannot alter default privileges for role supabase_admin (tables)';
  end;

  begin
    execute 'alter default privileges for role supabase_admin in schema public revoke all on sequences from anon';
  exception when insufficient_privilege then
    raise notice '0016: cannot alter default privileges for role supabase_admin (sequences)';
  end;

  begin
    execute 'alter default privileges for role supabase_admin in schema public revoke execute on functions from anon';
  exception when insufficient_privilege then
    raise notice '0016: cannot alter default privileges for role supabase_admin (functions)';
  end;
end $$;

-- ---------------------------------------------------------------------------
-- 5. authenticated
-- ---------------------------------------------------------------------------
-- `authenticated` keeps SELECT, INSERT, UPDATE and DELETE: that is the Supabase
-- model, and it is what the app's session client relies on, with the company-scoped
-- policies from 0004 and 0014 as the actual boundary.
--
-- TRUNCATE, REFERENCES and TRIGGER are the exception. PostgREST cannot issue any
-- of the three, so no app path needs them, and TRUNCATE in particular is not
-- subject to RLS at all - it would be a way to empty a table without any policy
-- ever being consulted.
revoke truncate, references, trigger on all tables in schema public from authenticated;

-- PostgREST caches table privileges per role, so tell it to reload. Without this
-- the revoke is live in the database but the API keeps serving the old answer
-- until something else happens to invalidate the cache.
notify pgrst, 'reload schema';