#!/usr/bin/env node
/**
 * Telemetry simulator.
 *
 * Drives the ingestion endpoint the way a phone would, so the monitor can be
 * exercised end to end before the Android app exists.
 *
 * Why this exists: until ingestion was built, `scripts/seed.mjs` was the only
 * writer of `device_events`, so every screen in the module could only ever show
 * seeded rows. This script posts the same shapes through the real endpoint, which
 * means the token lookup, the validation rules, the quota, the idempotency index
 * and the position projection are actually exercised rather than assumed.
 *
 * One run simulates one device. Device tokens are stored hashed, so the plaintext
 * cannot be listed back out of the database - which is the point - and a run
 * therefore needs the token handed to it. To simulate several handsets, run this
 * once per token.
 *
 * Usage:
 *   node scripts/simulate-device.mjs --token <token>
 *   node scripts/simulate-device.mjs --token <token> --duration 30
 *   node scripts/simulate-device.mjs --token <token> --misbehaving
 *   node scripts/simulate-device.mjs --token <token> --once
 *
 * Only NEXT_PUBLIC_SUPABASE_URL is needed, and only to warn you early about a
 * misconfigured project; the endpoint itself needs nothing from here.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;

/** Where the dev server is listening. Next.js default. */
const APP_URL = process.env.APP_URL || "http://localhost:3000";

const argv = process.argv.slice(2);
function flag(name) {
  const at = argv.indexOf(`--${name}`);
  return at >= 0 && argv[at + 1] ? argv[at + 1] : null;
}
function has(name) {
  return argv.includes(`--${name}`);
}

const TOKEN = flag("token");
const RUN_SECONDS = Number(flag("duration") || 20);
const INTERVAL_MS = Number(flag("interval") || 2000);
const ONCE = has("once");
/** Misbehaving devices emit the fraud signals, so the queue has something in it. */
const MISBEHAVING = has("misbehaving");
/** Deterministic by default, so two runs are comparable. */
const SEED = Number(flag("seed") || 20261004);

if (!TOKEN) {
  console.error(
    "Missing --token.\n\n" +
      "Tokens are stored hashed and cannot be listed back, so issue one and keep it:\n" +
      "  POST /api/monitor/device-tokens  { employee_id, device_id }\n" +
      "The plaintext in that response is the only copy."
  );
  process.exit(1);
}

if (!SUPABASE_URL) {
  console.warn(
    "NEXT_PUBLIC_SUPABASE_URL is not set. That is fine for the simulation itself,\n" +
      "but it suggests the dev server is not configured either."
  );
}

/** Mulberry32: small, seedable. Reproducibility matters more than quality here. */
function makeRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rng = makeRng(SEED);

const pick = (list) => list[Math.floor(rng() * list.length)];
const chance = (p) => rng() < p;

// ---------------------------------------------------------------------------
// device behaviour
// ---------------------------------------------------------------------------

const SIALKOT = { lat: 32.4945, lng: 74.5229 };

/**
 * Events a healthy handset produces on its own.
 *
 * Weighted towards mundane faults on purpose: a simulator that fires `fake_gps`
 * constantly trains everyone to ignore the critical column.
 */
const RARE_EVENTS = [
  ["power_off", 0.03],
  ["force_stop", 0.015],
  ["battery_restrict", 0.01],
  ["location_off", 0.01],
  ["dead_zone", 0.02],
  ["heartbeat_gap", 0.02],
  ["sim_change", 0.002],
  ["battery_low", 0.04],
  ["developer_mode", 0.002],
];

/** Only a deliberately misbehaving device produces these. */
const FRAUD_EVENTS = [
  ["fake_gps", 0.06],
  ["impossible_travel", 0.05],
  ["data_cleared", 0.03],
  ["logged_in_not_synced", 0.05],
  ["out_of_zone", 0.04],
  ["time_diff", 0.05],
];

function maybeEvent(candidates) {
  const events = [];
  for (const [type, probability] of candidates) {
    if (chance(probability)) events.push(type);
  }
  return events;
}

let sequence = 0;
const nextId = (prefix) => `sim-${SEED}-${prefix}-${++sequence}`;

function jitter(base, metres) {
  // 1 degree of latitude is roughly 111km.
  return base + ((rng() - 0.5) * 2 * metres) / 111320;
}

function buildBatch() {
  const now = Date.now();
  const spread = MISBEHAVING ? 4000 : 300;

  const ping = {
    lat: jitter(SIALKOT.lat, spread),
    lng: jitter(SIALKOT.lng, spread),
    accuracy: Number((3 + rng() * 25).toFixed(1)),
    speed: chance(0.4) ? Number((rng() * 8).toFixed(2)) : 0,
    heading: Math.round(rng() * 359),
    battery_pct: Math.max(3, Math.round(100 - rng() * 40)),
    provider: pick(["gps", "fused", "network"]),
    state: "live",
    recorded_at: new Date(now - Math.round(rng() * 4000)).toISOString(),
    client_event_id: nextId("ping"),
  };

  const types = maybeEvent(RARE_EVENTS);
  if (MISBEHAVING) types.push(...maybeEvent(FRAUD_EVENTS));

  const events = types.map((type) => ({
    type,
    occurred_at: new Date(now - Math.round(rng() * 300000)).toISOString(),
    client_event_id: nextId(`ev-${type}`),
    meta: { simulated: true, seed: SEED },
  }));

  return { pings: [ping], events };
}

// ---------------------------------------------------------------------------
// posting
// ---------------------------------------------------------------------------

async function post(batch) {
  const response = await fetch(`${APP_URL}/api/track/ingest`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify(batch),
  });
  return { status: response.status, payload: await response.json().catch(() => ({})) };
}

async function main() {
  console.log(
    `Posting to ${APP_URL}/api/track/ingest` +
      (MISBEHAVING ? " as a misbehaving device" : " as a healthy device") +
      (ONCE ? " once" : ` every ${INTERVAL_MS}ms for ${RUN_SECONDS}s`)
  );

  const deadline = Date.now() + (ONCE ? 0 : RUN_SECONDS * 1000);
  let rounds = 0;
  let accepted = 0;
  let rejected = 0;
  const reasons = new Map();

  do {
    const batch = buildBatch();
    const { status, payload } = await post(batch);
    rounds += 1;

    if (status === 200) {
      accepted += 1;
      const { events = 0, pings = 0 } = payload.accepted || {};
      const bad = payload.rejected?.length || 0;
      rejected += bad;
      for (const problem of payload.rejected || []) {
        reasons.set(problem.error, (reasons.get(problem.error) || 0) + 1);
      }
      console.log(
        `  round ${rounds}: ${events} event(s), ${pings} ping(s) accepted` +
          (bad ? `, ${bad} row(s) rejected` : "")
      );
    } else if (status === 429) {
      console.error("\nQuota exhausted for today.");
      process.exit(1);
    } else {
      console.error(`\nHTTP ${status}: ${payload.error || ""} ${payload.message || ""}`);
      if (status === 401) {
        console.error("Token rejected: unknown, revoked or expired.");
      }
      process.exit(1);
    }

    if (Date.now() < deadline) await new Promise((r) => setTimeout(r, INTERVAL_MS));
  } while (Date.now() < deadline);

  console.log(`\n${rounds} round(s), ${accepted} batch(es) accepted.`);
  if (rejected) {
    console.log(`${rejected} row(s) rejected:`);
    for (const [reason, count] of reasons) console.log(`  ${reason}: ${count}`);
  } else {
    console.log("No rows rejected, which is the expected result for this shape of input.");
  }
  console.log("\nOpen /monitor for the dashboard, /monitor/alerts for the queue,");
  console.log("and /monitor/attendance/live for the live map.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});