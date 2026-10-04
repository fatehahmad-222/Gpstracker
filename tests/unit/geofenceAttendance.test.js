import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Static analysis of the geofence-attendance migration.
 *
 * `attendance_sessions` shipped with no writer at all. Not one line of product
 * code ever inserted a row: `lib/server/ingest.js` wrote device events, locations
 * and positions; `lib/server/attendance.js` only ever selected and closed; the
 * `sessions/[id]` route was PATCH-only with no create endpoint; and
 * `handle_location_insert` only synced live_locations and completed tasks. The
 * single thing that inserted was `scripts/seed.mjs`, so the punch log was only
 * ever demo data and every attendance screen and dashboard card read a table
 * nothing filled.
 *
 * None of that is visible from the code that reads the table, which is why the
 * gap survived nine phases, 763 unit tests, 21 E2E tests and a green build. These
 * assertions exist so the writer cannot quietly disappear again.
 */

const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");

const files = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort();

const all = files.map((f) => readFileSync(join(MIGRATIONS_DIR, f), "utf8")).join("\n");

const migration = "0019_monitor_geofence_attendance.sql";
const sql = existsSync(join(MIGRATIONS_DIR, migration)) ? readFileSync(join(MIGRATIONS_DIR, migration), "utf8") : "";
const retrySafety = "0020_monitor_attendance_retry_safety.sql";
const retrySql = existsSync(join(MIGRATIONS_DIR, retrySafety)) ? readFileSync(join(MIGRATIONS_DIR, retrySafety), "utf8") : "";
const grantSweep = "0021_monitor_revoke_authenticated_definers.sql";
const grantSql = existsSync(join(MIGRATIONS_DIR, grantSweep)) ? readFileSync(join(MIGRATIONS_DIR, grantSweep), "utf8") : "";
const ingest = readFileSync(join(process.cwd(), "lib", "server", "ingest.js"), "utf8");

describe("attendance_sessions has a writer", () => {
  it("0019 exists", () => {
    expect(sql).not.toBe("");
  });

  it("reconcile_geofence_session is created", () => {
    expect(sql).toMatch(/create or replace function public\.reconcile_geofence_session\(/i);
  });

  it("ingest actually calls it, so the writer is reachable", () => {
    expect(ingest).toMatch(/reconcile_geofence_session/);
  });

  it("the call is made with the newest ping, not an arrival time", () => {
    // Passing when the batch was received would stamp every punch with the
    // server clock, and a batch replayed hours later would fabricate hours.
    expect(ingest).toMatch(/p_at:\s*newest\.recorded_at/);
  });
});

describe("reconcile_geofence_session shape", () => {
  it("is SECURITY DEFINER with a pinned search_path", () => {
    expect(sql).toMatch(/security definer/i);
    expect(sql).toMatch(/set search_path = public/i);
  });

  it("is revoked from public and granted to service_role", () => {
    expect(sql).toMatch(
      /revoke execute on function public\.reconcile_geofence_session\([^)]+\) from public/i
    );
    expect(sql).toMatch(
      /grant execute on function public\.reconcile_geofence_session\([^)]+\) to service_role/i
    );
  });

  it("is revoked from authenticated, not just public", () => {
    // Supabase's platform default grants EXECUTE on new functions in `public` to
    // anon AND authenticated, independently of this repo's migrations. Revoking
    // from `public` alone left this SECURITY DEFINER function callable by any
    // signed-in account, which would let an employee invent their own punch.
    // Verified on the live project: the grant list read
    //   postgres=X, authenticated=X, service_role=X
    // until `revoke ... from authenticated` was added.
    expect(sql).toMatch(
      /revoke execute on function public\.reconcile_geofence_session\([^)]+\) from authenticated/i
    );
  });

  it("serialises concurrent batches per employee", () => {
    // Two pings landing in two transactions could otherwise both observe "no open
    // session" and both insert, producing a split shift.
    expect(sql).toMatch(/pg_advisory_xact_lock\(/i);
  });

  it("inserts attendance_sessions rather than only reading it", () => {
    expect(sql).toMatch(/insert into public\.attendance_sessions/i);
  });

  it("holds the open session row it decided to act on", () => {
    expect(sql).toMatch(/attendance_sessions%rowtype/i);
  });
});

describe("closing requires a sustained exit, not one bad ping", () => {
  it("tracks a strike counter", () => {
    expect(sql).toMatch(/out_strikes integer not null default 0/i);
  });

  it("closes only at the second consecutive out-of-area ping", () => {
    expect(sql).toMatch(/out_strikes \+ 1 < 2/i);
  });

  it("clears the streak as soon as the employee is back inside", () => {
    // Otherwise one out-of-area ping at lunchtime plus one at the end of the day
    // closes the shift in between.
    expect(sql).toMatch(/set out_strikes = 0/i);
  });
});

describe("the employee is told they are out of their assigned area", () => {
  it("emits an out_of_zone device event", () => {
    expect(sql).toMatch(/insert into public\.device_events/i);
    expect(sql).toMatch(/'out_of_zone'/);
  });

  it("'out_of_zone' is a type device_events actually accepts", () => {
    // The column has a check constraint, so a typo here would fail at runtime on
    // the one code path that reports the problem to the employee.
    const deviceEvents = all.match(/create table if not exists public\.device_events[\s\S]*?type text not null check \(type in \(([\s\S]*?)\)\)/i);
    expect(deviceEvents).not.toBeNull();
    expect(deviceEvents[1]).toMatch(/'out_of_zone'/);
  });

  it("closes with out_reason 'auto_location_off'", () => {
    expect(sql).toMatch(/out_reason = 'auto_location_off'/i);
  });

  it("'auto_location_off' is a reason attendance_sessions actually accepts", () => {
    const reasons = all.match(/out_reason text check \(out_reason in\s*\(([\s\S]*?)\)/i);
    expect(reasons).not.toBeNull();
    expect(reasons[1]).toMatch(/'auto_location_off'/);
  });

  it("is idempotent, so a retried batch cannot send the message twice", () => {
    expect(sql).toMatch(/client_event_id/i);
    expect(sql).toMatch(/on conflict do nothing/i);
  });
});

describe("late arrival", () => {
  it("reads the company grace setting already used by the attendance rollup", () => {
    expect(sql).toMatch(/late_grace_minutes/);
  });

  it("uses the company timezone rather than the database's", () => {
    expect(sql).toMatch(/at time zone v_tz/);
  });

  it("raises a violation", () => {
    expect(sql).toMatch(/insert into public\.violations/i);
    expect(sql).toMatch(/'late_arrival'/);
  });

  it("is deduped by the existing unresolved-violation index", () => {
    expect(all).toMatch(/violations_unresolved_unique/i);
  });
});

describe("an employee with no assigned area is not punished for it", () => {
  it("distinguishes 'assigned no area' from 'outside every area'", () => {
    // Collapsing the two states would let every ping from an unassigned employee
    // count as a strike, closing the session of anyone whose geofence was
    // unassigned part-way through a shift.
    expect(sql).toMatch(/v_assigned/i);
  });

  it("reuses the same haversine the location trigger uses for task completion", () => {
    expect(sql).toMatch(/6371000 \* 2 \* asin/i);
  });
});

describe("a stale retry cannot rewind attendance", () => {
  it("ignores a ping older than the newest position already held", () => {
    expect(sql).toMatch(/ep\.recorded_at > p_at/i);
  });

  it("and a redelivery of the very same ping is not counted as a new one", () => {
    // The guard above cannot catch a retry on its own: a resend carries the same
    // recorded_at, so the position compares equal rather than older and passes.
    // Against 0019 that landed a second strike and closed the session on one real
    // observation, breaking the agreed two-consecutive-pings rule.
    expect(retrySql).not.toBe("");
    expect(retrySql).toMatch(/add column if not exists last_reconciled_at/i);
    expect(retrySql).toMatch(/p_at <= v_session\.last_reconciled_at/i);
  });

  it("records the ping as spent on every path that acts", () => {
    // Inside, first strike and close each advance the mark; arrival records it on
    // insert. Leaving any one path unrecorded would let that observation be
    // reconsidered on a resend.
    const stamps = retrySql.match(/last_reconciled_at\s*=\s*p_at/gi) || [];
    expect(stamps).toHaveLength(3);
    expect(retrySql).toMatch(/source,\s*last_reconciled_at/i);
  });

  it("keeps the guard inside the database rather than in the ingest handler", () => {
    // Attendance feeds payroll. A future caller must not be able to break the
    // invariant by forgetting to check, so this asserts the SQL owns it.
    expect(retrySql).toMatch(/create or replace function public\.reconcile_geofence_session\(/i);
  });
});

describe("signed-in users cannot drive SECURITY DEFINER functions directly", () => {
  it("the sweep exists", () => {
    expect(grantSql).not.toBe("");
  });

  it("revokes execute from authenticated, not only from public", () => {
    // Supabase's platform default grants EXECUTE on new functions in `public` to
    // anon AND authenticated. `revoke ... from public` alone leaves the function
    // callable by any signed-in account, which for a SECURITY DEFINER function
    // means the caller bypasses RLS entirely.
    expect(grantSql).toMatch(/revoke execute on function .* from authenticated/i);
  });

  it("covers the functions that would let one tenant forge or destroy another's data", () => {
    for (const fn of [
      "upsert_employee_position",
      "prune_location_history",
      "auto_close_sessions",
      "detect_idle",
      "consume_api_quota",
      "recompute_attendance_daily",
      "schedule_presence_checks",
      "write_audit",
      "reconcile_geofence_session",
    ]) {
      expect(grantSql).toContain(`'${fn}'`);
    }
  });

  it("fails loudly rather than skipping a function it cannot find", () => {
    // A silently skipped revoke reads as a clean apply while leaving the
    // function exposed, which is the failure mode this whole migration exists
    // to prevent.
    expect(grantSql).toMatch(/raise exception/i);
    expect(grantSql).toMatch(/v_missing/i);
  });

  it("leaves start_task alone, or the employee app breaks", () => {
    expect(grantSql).not.toContain("'start_task'");
  });

  it("leaves the RLS policy helpers alone, or every policy breaks", () => {
    // These are evaluated as the querying role inside policy expressions, so they
    // must stay executable by it.
    for (const fn of [
      "same_company",
      "current_role",
      "is_admin",
      "is_company_admin_for",
      "is_my_employee",
      "current_company_id",
    ]) {
      expect(grantSql).not.toContain(`'${fn}'`);
    }
  });
});