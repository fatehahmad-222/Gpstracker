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
});