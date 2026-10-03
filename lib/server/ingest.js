import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import { normaliseBatch, LIMITS } from "@/lib/monitor/ingest";
import { upsertPosition } from "./positions";

/**
 * Device telemetry ingestion.
 *
 * The write path for everything the monitor displays. Nothing here trusts the
 * request: the employee and company come from the bearer token, the severity
 * comes from the signal catalogue, and coordinates are range-checked.
 *
 * Uses the service role deliberately. `device_events` and `locations` are RLS-
 * locked to admin/viewer because raw device data is the most sensitive material
 * in the product, and there is no RLS shape that says "this specific phone may
 * insert its own rows but may read nothing". So the route authorises the device
 * itself, with a credential that is not a user session.
 */

/** Quota: requests per device per day. Generous for a phone, finite for an attacker. */
export const DEFAULT_DAILY_LIMIT = 2000;

/**
 * Hash a bearer token for storage and lookup.
 *
 * sha256 with no salt is the right choice here and not a shortcut: the input is
 * 32 bytes of CSPRNG output with no guessable structure, so there is nothing for
 * a salt to defend against, and lookup has to be a plain indexed equality match.
 */
export function hashToken(token) {
  return createHash("sha256").update(String(token)).digest("hex");
}

/** Constant-time compare for anything an attacker could grind against. */
export function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  // timingSafeEqual throws on length mismatch, which would itself leak length.
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/** A fresh 32-byte token, base64url so it is safe in a header or a query string. */
export function mintToken() {
  return randomBytes(32).toString("base64url");
}

/** Pull the bearer token out of an Authorization header. */
export function bearerToken(request) {
  const header = request.headers.get("authorization") || "";
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : null;
}

/**
 * Read a JSON body, refusing anything oversized.
 *
 * `request.json()` is unbounded, and this is the one endpoint on the product that
 * accepts anonymous traffic: an unauthenticated body parser is a trivial memory
 * exhaustion vector. The check has to happen on the bytes as they arrive rather
 * than after parsing, because by then the allocation has already happened.
 *
 * Content-Length alone is not enough - it is absent on a chunked request and is
 * otherwise only a claim by the sender - so it is used as a cheap early exit and
 * the running total is what actually enforces the limit.
 *
 * Returns `{ body }`, `{ error: "body_too_large" }` or `{ error: "bad_json" }`
 * rather than throwing, so the route can map each to its own status code.
 */
export async function readBoundedJson(request, maxBytes = LIMITS.maxBatchBytes) {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    return { error: "body_too_large" };
  }

  const chunks = [];
  let total = 0;

  if (request.body) {
    const reader = request.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        // Stop reading rather than draining: the point is to not hold the body.
        await reader.cancel().catch(() => {});
        return { error: "body_too_large" };
      }
      chunks.push(value);
    }
  }

  const text = new TextDecoder().decode(Buffer.concat(chunks.map((c) => Buffer.from(c))));
  if (!text.trim()) return { body: {} };

  try {
    const body = JSON.parse(text);
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      return { error: "bad_json" };
    }
    return { body };
  } catch {
    return { error: "bad_json" };
  }
}

/**
 * Resolve a bearer token to the device it belongs to.
 *
 * Returns null for every failure — absent, unknown, revoked, expired — and never
 * says which, so the endpoint cannot be used to probe for valid tokens.
 */
export async function authenticateDevice(supabase, token) {
  if (!token) return null;

  const { data, error } = await supabase
    .from("device_tokens")
    .select("id, company_id, employee_id, device_id, revoked_at, expires_at")
    .eq("token_hash", hashToken(token))
    .is("revoked_at", null)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;
  if (data.expires_at && new Date(data.expires_at) <= new Date()) return null;

  return data;
}

/**
 * Issue a token for a device.
 *
 * Re-issuing for the same (employee, device) replaces the hash and clears any
 * revocation, which is how "reinstall the app on the same handset" works without
 * the old credential ever being revived.
 */
export async function issueDeviceToken(
  supabase,
  { companyId, employeeId, deviceId, label = null, expiresAt = null } = {}
) {
  const token = mintToken();
  const device = String(deviceId || "").trim().slice(0, 120);
  if (!device) return { error: "missing_device_id" };

  const { data: employee, error: employeeError } = await supabase
    .from("employees")
    .select("id, status, deleted_at")
    .eq("company_id", companyId)
    .eq("id", employeeId)
    .maybeSingle();

  if (employeeError) throw employeeError;
  // Tokens are only issued to live, active employees. Issuing to an archived
  // employee would let a stale handset keep reporting in.
  if (!employee || employee.status !== "active" || employee.deleted_at) {
    return { error: "employee_unavailable" };
  }

  const { data, error } = await supabase
    .from("device_tokens")
    .upsert(
      {
        company_id: companyId,
        employee_id: employeeId,
        device_id: device,
        token_hash: hashToken(token),
        label: label ? String(label).slice(0, 120) : null,
        revoked_at: null,
        expires_at: expiresAt,
      },
      { onConflict: "employee_id,device_id" }
    )
    .select("id, employee_id, device_id, label, created_at, expires_at")
    .maybeSingle();

  if (error) throw error;

  // The plaintext token is returned exactly once, here. It is not stored and
  // cannot be recovered afterwards.
  return { token, record: data };
}

/** Revoke a device. Idempotent: revoking an already-revoked token is a no-op. */
export async function revokeDeviceToken(supabase, { companyId, id }) {
  const { data, error } = await supabase
    .from("device_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("company_id", companyId)
    .eq("id", id)
    .is("revoked_at", null)
    .select("id, employee_id, device_id, revoked_at")
    .maybeSingle();

  if (error) throw error;
  return data;
}

/** Tokens for an employee, or the whole company when no employee is given. */
export async function listDeviceTokens(supabase, { companyId, employeeId } = {}) {
  let query = supabase
    .from("device_tokens")
    .select("id, employee_id, device_id, label, created_at, last_used_at, revoked_at, expires_at, employees ( id, emp_code, name )")
    .eq("company_id", companyId)
    .order("created_at", { ascending: false });

  if (employeeId) query = query.eq("employee_id", employeeId);

  const { data, error } = await query;
  if (error) throw error;

  return (data || []).map((row) => {
    const employee = Array.isArray(row.employees) ? row.employees[0] : row.employees;
    return {
      id: row.id,
      employee_id: row.employee_id,
      emp_code: employee?.emp_code || null,
      name: employee?.name || null,
      device_id: row.device_id,
      label: row.label,
      created_at: row.created_at,
      last_used_at: row.last_used_at,
      revoked_at: row.revoked_at,
      expires_at: row.expires_at,
      active: !row.revoked_at && (!row.expires_at || new Date(row.expires_at) > new Date()),
    };
  });
}

/**
 * Accept one batch from an authenticated device.
 *
 * Ordering matters and is deliberate:
 *   1. quota, before any write, so an over-quota device costs one row update
 *   2. events and pings, idempotently, via client_event_id
 *   3. device_profiles heartbeat
 *   4. the position projection, last
 *
 * A failure at any step is reported per-collection rather than thrown, because a
 * phone that gets a 500 for a batch of 40 events will retry all 40, and the
 * events that did land will be rejected as duplicates the second time. Reporting
 * partial success lets the device drop what it knows was accepted.
 */
export async function ingestBatch(supabase, { device, body, dailyLimit = DEFAULT_DAILY_LIMIT }) {
  const { events, pings, problems } = normaliseBatch(body);

  // Reject before writing if the body is wildly oversized. `readJson` has already
  // run, so this is a cheap second line of defence rather than the only one.
  const accepted = events.length + pings.length;
  if (!accepted && !problems.length) {
    return { ok: true, events: 0, pings: 0, rejected: [], message: "empty batch" };
  }

  const { data: allowed, error: quotaError } = await supabase.rpc("consume_api_quota", {
    p_kind: "device_ingest",
    p_limit: dailyLimit,
    p_period: "day",
    p_company_id: device.company_id,
  });

  if (quotaError) throw quotaError;
  if (allowed === false) {
    return { error: "quota_exceeded", limit: dailyLimit };
  }

  const result = { events: 0, pings: 0, rejected: problems, position: null };

  if (events.length) {
    const rows = events.map((event) => ({
      company_id: device.company_id,
      employee_id: device.employee_id,
      type: event.type,
      severity: event.severity,
      occurred_at: event.occurred_at,
      client_event_id: event.client_event_id,
      meta: event.meta,
    }));

    // `ignoreDuplicates` is what makes a retry safe: the partial unique index on
    // (employee_id, client_event_id) turns the replay into a no-op instead of a
    // second row that would inflate the tiles and the risk score.
    const { error } = await supabase
      .from("device_events")
      .upsert(rows, { onConflict: "employee_id,client_event_id", ignoreDuplicates: true });
    if (error) throw error;
    result.events = rows.length;
  }

  if (pings.length) {
    // `locations` is keyed on profiles(id) for the original Fleet Console tracker,
    // so the monitor's employee id has to be translated before insertion. One
    // lookup for the whole batch.
    const { data: employee, error: employeeError } = await supabase
      .from("employees")
      .select("profile_id")
      .eq("company_id", device.company_id)
      .eq("id", device.employee_id)
      .maybeSingle();

    if (employeeError) throw employeeError;

    if (employee?.profile_id) {
      const rows = pings.map((ping) => ({
        company_id: device.company_id,
        employee_id: employee.profile_id,
        lat: ping.lat,
        lng: ping.lng,
        accuracy: ping.accuracy,
        speed: ping.speed,
        heading: ping.heading,
        battery_pct: ping.battery_pct,
        provider: ping.provider,
        state: ping.state,
        recorded_at: ping.recorded_at,
        client_event_id: ping.client_event_id,
        source: "mobile_app",
      }));

      const { error } = await supabase
        .from("locations")
        .upsert(rows, { onConflict: "employee_id,client_event_id", ignoreDuplicates: true });
      if (error) throw error;
      result.pings = rows.length;
    } else {
      // An employee with no linked profile cannot satisfy the locations FK. Not
      // fatal: the events still landed, and the employee is not yet using the
      // original Fleet Console tracker.
      result.rejected.push({
        scope: "ping",
        error: "employee_has_no_profile",
        detail: `${pings.length} ping(s) dropped`,
      });
    }

    // The "where is everyone right now" projection takes only the newest ping,
    // and only when it is newer than what is already stored, so an out-of-order
    // retry cannot rewind the map.
    const newest = [...pings].sort((a, b) => new Date(b.recorded_at) - new Date(a.recorded_at))[0];
    if (newest) {
      result.position = await upsertPosition(supabase, {
        companyId: device.company_id,
        employeeId: device.employee_id,
        lat: newest.lat,
        lng: newest.lng,
        accuracy: newest.accuracy,
        speed: newest.speed,
        heading: newest.heading,
        battery: newest.battery_pct,
        recordedAt: newest.recorded_at,
      });
    }
  }

  // Heartbeat last: `last_sync_at` is only meaningful if it means "the device
  // reached us", and it did, even if some rows were rejected.
  await supabase
    .from("device_tokens")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", device.id)
    .is("revoked_at", null);

  await supabase
    .from("device_profiles")
    .upsert(
      {
        company_id: device.company_id,
        employee_id: device.employee_id,
        device_id: device.device_id,
        last_sync_at: new Date().toISOString(),
      },
      { onConflict: "employee_id,device_id" }
    );

  return { ok: true, ...result };
}

export { LIMITS };