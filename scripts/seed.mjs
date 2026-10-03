#!/usr/bin/env node
/**
 * Seed the GPS Work Force Monitor demo dataset.
 *
 *   node --env-file-if-exists=.env.local scripts/seed.mjs
 *   node --env-file-if-exists=.env.local scripts/seed.mjs --reset
 *
 * Uses the service-role key, so it bypasses RLS — it is a maintenance script,
 * never imported by the app.
 *
 * Idempotent: re-running updates the same rows rather than duplicating them.
 * `--reset` deletes the module's demo rows first.
 *
 * Note on scale: 7 days of pings for 40 employees at a 3 s interval would be
 * ~3.2 M rows. We deliberately seed a coarse historical track (one fix every
 * 5 minutes) plus a dense track for today, and leave production-rate ingestion
 * to `scripts/simulate-device.mjs`.
 */

import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

import {
  COMPANY,
  PLACES,
  DEPARTMENTS,
  SUB_DEPARTMENTS,
  DESIGNATIONS,
  buildEmployees,
  POLICIES,
  GEOFENCES,
  assignmentsFor,
  EVENT_SEVERITY,
  EVENT_CATEGORY,
  VIOLATION_SEVERITIES,
} from "./seed-data.mjs";

// ---------------------------------------------------------------------------
// config
// ---------------------------------------------------------------------------

const args = new Set(process.argv.slice(2));
const RESET = args.has("--reset");
const DAYS = 7;

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error(
    "\n  Missing Supabase credentials.\n" +
      "  Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local\n" +
      "  (service-role key: Supabase Project Settings -> API -> service_role).\n"
  );
  process.exit(1);
}

const db = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const COMPANY_ID = COMPANY.id;
const TZ = COMPANY.timezone;

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

let created = 0;
let updated = 0;

function log(msg) {
  console.log(`  ${msg}`);
}

function ok(msg) {
  created += 1;
  console.log(`  + ${msg}`);
}

function fail(table, error) {
  console.error(`\n  FAILED on ${table}:\n  ${error?.message || error}\n`);
  process.exit(1);
}

/** Insert rows, returning them. */
async function insert(table, rows, { ignoreDuplicates = false } = {}) {
  if (!rows.length) return [];
  const { data, error } = await db
    .from(table)
    .insert(rows)
    .select("*")
    .limit(rows.length * 2);
  if (error) fail(table, error);
  log(`${table}: ${data?.length ?? 0} row(s)`);
  return data || [];
}

async function upsert(table, rows, onConflict) {
  if (!rows.length) return [];
  const { data, error } = await db
    .from(table)
    .upsert(rows, { onConflict, ignoreDuplicates: false })
    .select("*");
  if (error) fail(table, error);
  log(`${table}: ${data?.length ?? 0} row(s) upserted`);
  return data || [];
}

async function wipe() {
  console.log("\nResetting demo data...");
  // audit_log has no DELETE policy, but service role bypasses RLS.
  const order = [
    "device_events",
    "violations",
    "attendance_daily",
    "attendance_sessions",
    "presence_checks",
    "policies",
    "employee_geofences",
    "locations",
    "live_locations",
    "device_profiles",
    "geofences",
    "employees",
    "designations",
    "sub_departments",
    "departments",
    "leaves",
    "api_usage_counters",
    "tasks",
  ];
  for (const table of order) {
    const column = table === "employees" ? "company_id" : "company_id";
    const { error } = await db.from(table).delete().eq(column, COMPANY_ID);
    if (error && !/does not exist/i.test(error.message)) {
      // Tables that do not exist yet are fine.
      if (!/schema cache|not exist/i.test(error.message)) fail(table, error);
    }
  }
  log(`cleared ${order.length} table(s)`);
}

/** Company-local day boundaries as UTC instants. */
function dayRange(daysAgo) {
  const now = new Date();
  const local = new Date(now.getTime() + (5 * 60 + 30) * 60000); // PKT is UTC+5
  local.setUTCDate(local.getUTCDate() - daysAgo);
  const y = local.getUTCFullYear();
  const m = local.getUTCMonth();
  const d = local.getUTCDate();
  const start = Date.UTC(y, m, d) - 5.5 * 3600000;
  const end = Date.UTC(y, m, d + 1) - 5.5 * 3600000;
  return { start, end };
}

function isoAt(utcMs) {
  return new Date(utcMs).toISOString();
}

/** Minutes-from-midnight -> UTC ms for a given company day. */
function shiftInstant(dayStartUtcMs, shiftMinutes, addDays = 0) {
  return dayStartUtcMs + shiftMinutes * 60000 + addDays * 86400000;
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main() {
  console.log("\nGPS Work Force Monitor — seeding demo data");
  console.log(`  company: ${COMPANY.code} (${COMPANY_ID})\n`);

  if (RESET) await wipe();

  // --- company ---------------------------------------------------------
  const { data: company, error: companyErr } = await db
    .from("companies")
    .upsert(
      [{ id: COMPANY_ID, name: COMPANY.name, company_code: COMPANY.code, timezone: TZ, settings: {} }],
      { onConflict: "id" }
    )
    .select()
    .single();
  if (companyErr) fail("companies", companyErr);
  log(`company ${company.company_code} ready`);

  // --- departments -----------------------------------------------------
  const departments = await upsert(
    "departments",
    DEPARTMENTS.map((d) => ({ company_id: COMPANY_ID, name: d.name, code: d.code, status: "active" })),
    "company_id,name"
  );
  const deptByName = Object.fromEntries(departments.map((d) => [d.name, d]));

  // --- sub departments -------------------------------------------------
  const subDepartments = await upsert(
    "sub_departments",
    SUB_DEPARTMENTS.filter((s) => deptByName[s.department]).map((s) => ({
      company_id: COMPANY_ID,
      department_id: deptByName[s.department].id,
      name: s.name,
      code: s.code,
      status: "active",
    })),
    "company_id,department_id,name"
  );
  log(`sub departments: ${subDepartments.length}`);

  // --- designations ----------------------------------------------------
  const designations = await upsert(
    "designations",
    DESIGNATIONS.filter((d) => deptByName[d.department]).map((d) => ({
      company_id: COMPANY_ID,
      department_id: deptByName[d.department].id,
      name: d.name,
      code: d.code,
      status: "active",
    })),
    "company_id,name"
  );
  const desigByName = Object.fromEntries(designations.map((d) => [d.name, d]));

  // --- employees -------------------------------------------------------
  const seedEmployees = buildEmployees(40);
  const employeeRows = seedEmployees.map((e) => {
    const [sh, sm] = e.shift_start.split(":").map(Number);
    const [eh, em] = e.shift_end.split(":").map(Number);
    return {
      company_id: COMPANY_ID,
      emp_code: e.emp_code,
      name: e.name,
      father_husband_name: e.father_husband_name,
      dob: `19${80 + (e.emp_code.charCodeAt(4) % 20)}-${String((e.emp_code.charCodeAt(5) % 12) + 1).padStart(2, "0")}-${String((e.emp_code.charCodeAt(6) % 28) + 1).padStart(2, "0")}`,
      gender: e.gender,
      marital_status: e.marital_status,
      cnic: e.cnic,
      phone: e.contact_no,
      email: e.email,
      address: e.address,
      hire_date: e.hire_date,
      education: e.education,
      department_id: deptByName[e.department]?.id || null,
      designation_id: desigByName[e.designation]?.id || null,
      last_job_history: e.last_job_history,
      shift_start: sh * 60 + sm,
      shift_end: eh * 60 + em,
      basic_salary: e.basic_salary,
      payment_method: e.payment_method,
      late_deduction: e.late_deduction,
      overtime_allowed: e.overtime_allowed,
      absent_deduction: e.absent_deduction,
      wht_tax: e.wht_tax,
      // Demo password is documented in the README; never a real secret.
      app_password_hash: null,
      geofencing_enabled: e.geofencing_enabled,
      attendance_source: e.attendance_source,
      tracking_consent: e.tracking_consent,
      consent_at: new Date().toISOString(),
      status: e.status,
      deleted_at: e.deleted ? new Date().toISOString() : null,
    };
  });

  const employees = await upsert("employees", employeeRows, "company_id,emp_code");
  const employeeByCode = Object.fromEntries(employees.map((e) => [e.emp_code, e]));

  // --- geofences -------------------------------------------------------
  // No natural unique key on geofences, so replace the demo set each run.
  await db.from("employee_geofences").delete().eq("company_id", COMPANY_ID);
  await db.from("geofences").delete().eq("company_id", COMPANY_ID);

  const fenceRows = GEOFENCES.map((f) => {
    const base = {
      company_id: COMPANY_ID,
      name: f.name,
      type: f.type,
      description: f.description || "",
      color: f.color,
      status: "active",
      buffer_m: f.buffer_m ?? 50,
      travel_mode: f.travel_mode || null,
    };

    if (f.type === "circle") {
      const place = PLACES[f.place];
      return {
        ...base,
        geometry: { type: "Point", coordinates: [place.lng, place.lat] },
        center_lat: place.lat,
        center_lng: place.lng,
        radius_m: f.radius_m,
      };
    }
    if (f.type === "rectangle") {
      return {
        ...base,
        geometry: {
          type: "Polygon",
          coordinates: [[
            [f.sw.lng, f.sw.lat],
            [f.ne.lng, f.sw.lat],
            [f.ne.lng, f.ne.lat],
            [f.sw.lng, f.ne.lat],
            [f.sw.lng, f.sw.lat],
          ]],
        },
      };
    }
    if (f.type === "polygon") {
      return { ...base, geometry: { type: "Polygon", coordinates: [f.polygon] } };
    }
    // route
    return {
      ...base,
      geometry: { type: "LineString", coordinates: f.line },
      origin: { coordinates: f.line[0] },
      destination: { coordinates: f.line[f.line.length - 1] },
      waypoints: [],
      distance_km: null,
      duration_min: null,
    };
  });

  const geofences = await insert("geofences", fenceRows);
  const fenceIndex = Object.fromEntries(GEOFENCES.map((f, i) => [f.name, i]));

  // --- employee <-> fence assignments ----------------------------------
  const assignmentRows = [];
  for (const seed of seedEmployees) {
    const employee = employeeByCode[seed.emp_code];
    if (!employee || employee.deleted_at) continue;
    const names =
      seed.department === "Sales"
        ? ["Lahore Regional Office", "Sialkot Warehouse Hub"]
        : ["Sialkot Head Office", "Sialkot Warehouse Hub"];
    for (const name of names) {
      const fence = geofences[fenceIndex[name]];
      if (!fence) continue;
      assignmentRows.push({
        company_id: COMPANY_ID,
        employee_id: employee.id,
        geofence_id: fence.id,
      });
    }
  }
  await upsert("employee_geofences", assignmentRows, "employee_id,geofence_id");

  // --- latest positions -------------------------------------------------
  // The live map reads this projection, so seed it or the first run shows an
  // empty map. Most people are placed at their assigned fence, a few are
  // deliberately outside it, and one is left with no fix at all so the
  // "never reported" state is visible without having to unplug a phone.
  await db.from("employee_positions").delete().eq("company_id", COMPANY_ID);

  const placedAt = {
    "Sialkot Head Office": PLACES.sialkotOffice,
    "Sialkot Warehouse Hub": PLACES.sialkotHub,
    "Gujranwala Branch": PLACES.gujranwala,
    "Lahore Regional Office": PLACES.lahoreOffice,
    "Lahore Distribution Hub": PLACES.lahoreHub,
    "Faisalabad Depot": PLACES.faisalabad,
  };

  const positionRows = [];
  for (const seed of seedEmployees) {
    const employee = employeeByCode[seed.emp_code];
    if (!employee || employee.deleted_at) continue;

    // Every 9th employee has no fix yet.
    if (seed.emp_code.charCodeAt(seed.emp_code.length - 1) % 9 === 0) continue;

    const assigned = assignmentRows
      .filter((row) => row.employee_id === employee.id)
      .map((row) => geofences.find((g) => g.id === row.geofence_id))
      .filter(Boolean);

    const home = placedAt[assigned[0]?.name] || PLACES.sialkotOffice;

    // Every 7th is nudged ~1.2 km off their fence, so "outside" has real data.
    const stray = seed.emp_code.charCodeAt(seed.emp_code.length - 1) % 7 === 0;
    const jitter = (n, scale) => n + (((seed.emp_code.length * 7 + n) % 13) - 6) * scale;

    const ageSeconds = (seed.emp_code.charCodeAt(seed.emp_code.length - 1) % 25) * 60;

    positionRows.push({
      company_id: COMPANY_ID,
      employee_id: employee.id,
      lat: jitter(home.lat, stray ? 0.011 : 0.002),
      lng: jitter(home.lng, stray ? 0.013 : 0.002),
      accuracy: 8 + (seed.emp_code.charCodeAt(seed.emp_code.length - 1) % 20),
      speed: stray ? 0.9 : 0.05,
      heading: (seed.emp_code.charCodeAt(seed.emp_code.length - 1) * 11) % 360,
      battery: 12 + (seed.emp_code.charCodeAt(seed.emp_code.length - 1) * 3) % 88,
      recorded_at: new Date(Date.now() - ageSeconds * 1000).toISOString(),
    });
  }

  if (positionRows.length) {
    const { error: positionError } = await db
      .from("employee_positions")
      .upsert(positionRows, { onConflict: "employee_id" });
    if (positionError) throw positionError;
  }

  // --- policies --------------------------------------------------------
  await db.from("presence_checks").delete().eq("company_id", COMPANY_ID);
  await db.from("policies").delete().eq("company_id", COMPANY_ID);

  const policyRows = POLICIES.map((p) => ({
    company_id: COMPANY_ID,
    name: p.name,
    type: p.type,
    description: p.description,
    effective_from: "2026-09-01",
    status: "active",
    scope: p.scope,
    scope_ref_id:
      p.scope === "department" ? deptByName[p.scope_ref_department]?.id || null : null,
    params: p.params,
  }));
  await insert("policies", policyRows);

  // --- device profiles -------------------------------------------------
  const activeEmployees = employees.filter((e) => !e.deleted_at);
  const deviceRows = activeEmployees.map((employee) => {
    const seed = seedEmployees.find((s) => s.emp_code === employee.emp_code);
    const device = seed.device;
    return {
      company_id: COMPANY_ID,
      employee_id: employee.id,
      device_id: device.device_id,
      model: device.model,
      manufacturer: device.manufacturer,
      android_version: device.android_version,
      app_version: device.app_version,
      last_login_at: isoAt(Date.now() - 3600000),
      // ~1 in 6 employees has never synced, so "No sync 24h+" has content.
      last_sync_at:
        seed.emp_code.charCodeAt(5) % 6 === 0
          ? null
          : isoAt(Date.now() - (seed.emp_code.charCodeAt(6) % 40) * 3600000),
      login_count: 1 + (seed.emp_code.charCodeAt(4) % 20),
      sim_fingerprint_hash: null,
    };
  });
  await upsert("device_profiles", deviceRows, "employee_id,device_id");

  // --- attendance sessions + pings + events ----------------------------
  const sessions = [];
  const pings = [];
  const events = [];

  for (let daysAgo = DAYS - 1; daysAgo >= 0; daysAgo--) {
    const { start: dayStart } = dayRange(daysAgo);
    const today = daysAgo === 0;

    for (const employee of activeEmployees) {
      const seed = seedEmployees.find((s) => s.emp_code === employee.emp_code);
      const code = seed.emp_code;

      // Skip ~1 in 9 employees on some days so absent / shift-not-started
      // rows exist for the dashboard business rules to be visible.
      if (!today && (code.charCodeAt(7) + daysAgo) % 9 === 0) continue;
      if (!today && (code.charCodeAt(8) + daysAgo) % 11 === 0) continue; // absent

      const shiftStart = employee.shift_start;
      const lateBy = (code.charCodeAt(6) % 4) * 6; // 0/6/12/18 minutes late
      const clockInMs = shiftInstant(dayStart, shiftStart) + lateBy * 60000;
      if (today && clockInMs > Date.now()) continue; // not clocked in yet

      const workedHours = 7 + (code.charCodeAt(7) % 4);
      const clockOutMs = clockInMs + workedHours * 3600000;
      const stillIn = today && Date.now() - clockInMs < 6 * 3600000 && lateBy === 0;

      const office = PLACES.sialkotOffice;
      const jitter = () => (Math.random() - 0.5) * 0.004;

      const session = {
        company_id: COMPANY_ID,
        employee_id: employee.id,
        clock_in_at: isoAt(clockInMs),
        clock_out_at: stillIn ? null : isoAt(Math.min(clockOutMs, Date.now())),
        clock_in_lat: office.lat + jitter(),
        clock_in_lng: office.lng + jitter(),
        clock_out_lat: office.lat + jitter() * 2,
        clock_out_lng: office.lng + jitter() * 2,
        out_reason: stillIn ? null : lateBy > 12 ? "auto_shift_end" : "user",
        source: "GPS APP",
        client_event_id: `seed-${code}-${daysAgo}-in`,
      };
      sessions.push(session);

      // A route track: dense for today, one fix per 5 min for history.
      const stepMs = today ? 5 * 60000 : 5 * 60000;
      const endMs = Math.min(
        stillIn ? Date.now() : Math.min(clockOutMs, Date.now()),
        today ? Date.now() : dayStart + 86400000
      );
      const maxPings = today ? 90 : 60;
      let n = 0;
      for (let t = clockInMs; t <= endMs && n < maxPings; t += stepMs, n++) {
        const drift = Math.sin(n / 6) * 0.0025;
        pings.push({
          company_id: COMPANY_ID,
          employee_id: employee.id,
          lat: office.lat + drift + jitter() * 0.4,
          lng: office.lng + drift + jitter() * 0.4,
          accuracy: 8 + (n % 12),
          speed: (n % 5) * 0.4,
          heading: (n * 37) % 360,
          recorded_at: isoAt(t),
          battery_pct: Math.max(8, 100 - n * (today ? 1.2 : 0.4)),
          provider: n % 3 === 0 ? "fused" : "gps",
          is_mock: false,
          state: "live",
          source: "mobile_app",
          client_event_id: `seed-${code}-${daysAgo}-${n}`,
        });
      }

      // Device events, so the Command Center has rows to drill into.
      if (today) {
        const addEvent = (type, minutesAgo, meta = {}) => {
          events.push({
            company_id: COMPANY_ID,
            employee_id: employee.id,
            type,
            severity: EVENT_SEVERITY[type] || "medium",
            occurred_at: isoAt(Date.now() - minutesAgo * 60000),
            reported_at: isoAt(Date.now() - Math.max(0, minutesAgo - 20) * 60000),
            client_event_id: `seed-${code}-${type}-${daysAgo}`,
            meta,
          });
        };

        if (lateBy > 12) addEvent("force_stop", 45 + (code.charCodeAt(5) % 120));
        if (!seed.device.supported && (code.charCodeAt(8) % 3 === 0)) {
          addEvent("location_off", 90 + (code.charCodeAt(4) % 200));
        }
        if (code.charCodeAt(9) % 7 === 0) addEvent("battery_low", 25, { battery_pct: 12 });
        if (code.charCodeAt(10) % 13 === 0) addEvent("fake_gps", 300, { mock_provider: "FakeGPS" });
        if (code.charCodeAt(11) % 5 === 0) {
          addEvent("out_of_zone", 150, { fence: "Sialkot Market Zone", distance_m: 900 });
        }
      }
    }
  }

  await upsert("attendance_sessions", sessions, "employee_id,clock_in_at");
  // Pings: plain insert with the client_event_id index giving idempotency.
  const pingChunks = chunk(pings, 900);
  for (const c of pingChunks) {
    const { error } = await db.from("locations").upsert(c, {
      onConflict: "employee_id,client_event_id",
      ignoreDuplicates: true,
    });
    if (error) fail("locations", error);
  }
  log(`locations: ${pings.length} ping(s) upserted`);

  for (const c of chunk(events, 800)) {
    const { error } = await db.from("device_events").upsert(c, {
      onConflict: "employee_id,type,occurred_at,client_event_id",
      ignoreDuplicates: true,
    });
    if (error) fail("device_events", error);
  }
  log(`device_events: ${events.length} event(s) upserted`);

  // --- violations (the Alerts & Violation queue) -------------------------
  // Mirrors `violationsFromEvents` in lib/monitor/alerts.js: medium-or-worse
  // only, and one unresolved violation per employee+signal keeping the earliest
  // occurrence. The severity/category maps come from seed-data.mjs because this
  // script runs under plain node with no build step or `@/` alias;
  // tests/unit/alerts.test.js asserts those copies still agree with the signal
  // catalogue, so they cannot drift silently.
  const firstSignalPerEmployee = new Map();
  for (const ev of events) {
    if (!VIOLATION_SEVERITIES.includes(ev.severity)) continue;
    const key = `${ev.employee_id}::${ev.type}`;
    const seen = firstSignalPerEmployee.get(key);
    if (!seen || new Date(ev.occurred_at) < new Date(seen.occurred_at)) {
      firstSignalPerEmployee.set(key, ev);
    }
  }

  const violationRows = [...firstSignalPerEmployee.values()].map((ev, i) => ({
    company_id: COMPANY_ID,
    employee_id: ev.employee_id,
    type: ev.type,
    category: EVENT_CATEGORY[ev.type] || "Other",
    severity: ev.severity,
    occurred_at: ev.occurred_at,
    // Spread across the lifecycle so the queue, the status filter and the
    // timeline all have something to show instead of one uniform block of
    // "open" - which would hide whether the filters work at all.
    status: i % 7 === 0 ? "resolved" : i % 3 === 0 ? "acknowledged" : "open",
    meta: ev.meta || {},
  }));

  await db.from("violations").delete().eq("company_id", COMPANY_ID);
  for (const c of chunk(violationRows, 500)) {
    const { error } = await db.from("violations").insert(c);
    if (error) fail("violations", error);
  }
  log(`violations: ${violationRows.length} row(s) inserted`);

  // --- leaves (dashboard counters) --------------------------------------
  const leaves = activeEmployees.slice(0, 12).map((employee, i) => ({
    company_id: COMPANY_ID,
    employee_id: employee.id,
    leave_type: ["casual", "sick", "annual"][i % 3],
    from_date: new Date().toISOString().slice(0, 10),
    to_date: new Date().toISOString().slice(0, 10),
    status: ["pending", "approved", "rejected"][i % 3],
    reason: "Seeded demo request",
  }));
  await db.from("leaves").delete().eq("company_id", COMPANY_ID);
  await insert("leaves", leaves);

  // --- tasks (dashboard counters; reuses the existing tasks table) ------
  const { data: adminProfile } = await db
    .from("profiles")
    .select("id")
    .eq("role", "admin")
    .limit(1)
    .maybeSingle();

  await db.from("tasks").delete().eq("company_id", COMPANY_ID);
  const taskRows = activeEmployees.slice(0, 16).map((employee, i) => ({
    company_id: COMPANY_ID,
    admin_id: adminProfile?.id || null,
    employee_id: employee.profile_id || employee.id,
    title: ["Site visit", "Delivery", "Stock check", "Client meeting"][i % 4],
    description: "Seeded demo task",
    target_lat: PLACES.sialkotOffice.lat + (i % 5) * 0.001,
    target_lng: PLACES.sialkotOffice.lng + (i % 5) * 0.001,
    target_address: PLACES.sialkotOffice.name,
    radius_meters: 150,
    status: i % 3 === 0 ? "completed" : i % 3 === 1 ? "in_progress" : "pending",
    completion_source: i % 3 === 0 ? "geofence" : null,
    due_at: isoAt(Date.now() + 86400000),
  }));
  await insert("tasks", taskRows);

  // --- summary ----------------------------------------------------------
  console.log("\nSeed complete.");
  console.log(`  employees:  ${employees.length}`);
  console.log(`  departments:${departments.length}  sub-departments: ${subDepartments.length}  designations: ${designations.length}`);
  console.log(`  geofences:  ${geofences.length}`);
  console.log(`  positions:  ${positionRows.length}`);
  console.log(`  policies:   ${POLICIES.length}`);
  console.log(`  sessions:   ${sessions.length}`);
  console.log(`  pings:      ${pings.length}`);
  console.log(`  events:     ${events.length}`);
  console.log("\n  Next: npm run dev, then sign in as an admin and open /monitor\n");
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

export { randomUUID };