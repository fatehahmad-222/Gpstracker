/**
 * Device telemetry ingestion — validation and normalisation.
 *
 * This is the only place untrusted input enters the monitor, so the rules are
 * deliberately strict and the reasons are explicit. Everything here is pure so
 * it can be tested without a database, which matters more than usual for a
 * function whose failure mode is "attacker gets data they should not see".
 *
 * Three assumptions are made about the caller, and each is enforced:
 *   1. The payload is from a phone, not a trusted service. Every field is
 *      treated as hostile until validated.
 *   2. The device's clock is not trustworthy. `occurred_at` is clamped rather
 *      than believed, because the whole anti-fraud product is built on comparing
 *      device time to server time — a device that can set that freely can forge
 *      the evidence.
 *   3. A batch is one atomic claim about one device. Nothing in a batch is
 *      allowed to name a different employee than the authenticated one.
 */

import { SIGNAL_BY_KEY, EVENT_TYPE_TO_SIGNAL } from "./signals";

/** Event types the database will accept, taken from the 0007 check constraint. */
export const INGEST_EVENT_TYPES = Object.keys(EVENT_TYPE_TO_SIGNAL);

/** Caps that stop one request becoming a denial of service. */
export const LIMITS = {
  maxEvents: 200,
  maxPings: 500,
  maxMetaBytes: 4096,
  maxBatchBytes: 512 * 1024,
  maxClockSkewSeconds: 900, // 15 minutes either side
  maxEventAgeDays: 7, // an event older than this is a replay, not history
};

/** Reasons a field can be refused, so the client gets a usable error. */
export const REJECT = {
  UNKNOWN_TYPE: "unknown_event_type",
  BAD_TIMESTAMP: "bad_timestamp",
  FUTURE_TIMESTAMP: "timestamp_too_far_ahead",
  STALE_TIMESTAMP: "timestamp_too_old",
  BAD_COORDINATE: "bad_coordinate",
  BAD_BATTERY: "bad_battery",
  MISSING_CLIENT_ID: "missing_client_event_id",
  BAD_VALUE: "bad_value",
  META_TOO_LARGE: "meta_too_large",
};

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function cleanString(value, maxLength = 200) {
  if (value == null) return null;
  const text = String(value).trim();
  if (!text) return null;
  return text.slice(0, maxLength);
}

/** JSON size, measured on the serialised form since that is what is stored. */
function metaBytes(meta) {
  try {
    return JSON.stringify(meta ?? {}).length;
  } catch {
    // Circular or otherwise unserialisable: treated as oversized rather than
    // allowed to reach the driver and fail mid-batch.
    return Infinity;
  }
}

/**
 * Clamp a device timestamp into something believable.
 *
 * A phone with a wrong clock is normal and should not lose data, so small skew
 * is preserved — the gap between occurred_at and reported_at is itself a signal
 * the Alerts screen reports. What is refused is a timestamp far enough out to be
 * indistinguishable from forgery, and one so old it can only be a replay.
 */
export function validateTimestamp(value, now = new Date()) {
  if (typeof value !== "string" && typeof value !== "number") {
    return { error: REJECT.BAD_TIMESTAMP };
  }

  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return { error: REJECT.BAD_TIMESTAMP };

  const skewSeconds = Math.round((at.getTime() - now.getTime()) / 1000);

  if (skewSeconds > LIMITS.maxClockSkewSeconds) return { error: REJECT.FUTURE_TIMESTAMP };
  if (skewSeconds < -LIMITS.maxEventAgeDays * 86400) return { error: REJECT.STALE_TIMESTAMP };

  return { at: at.toISOString(), skewSeconds };
}

/**
 * Severity for an event type.
 *
 * Taken from the signal catalogue rather than the request: a device that could
 * choose its own severity could downgrade a `fake_gps` to `medium` and keep it
 * out of the queue.
 */
export function severityFor(type) {
  const keys = EVENT_TYPE_TO_SIGNAL[type];
  if (!keys?.length) return null;
  return SIGNAL_BY_KEY[keys[0]]?.severity || "medium";
}

/**
 * Validate one event.
 *
 * Returns `{ ok: true, event }` or `{ ok: false, index, error, detail }`. Events
 * are validated individually and rejected individually: one malformed event must
 * not discard a whole batch, because a phone buffering offline would otherwise
 * lose its entire history to a single bad row.
 */
export function normaliseEvent(raw, { now = new Date() } = {}) {
  const type = cleanString(raw?.type, 60);
  if (!type || !EVENT_TYPE_TO_SIGNAL[type]) {
    return { ok: false, error: REJECT.UNKNOWN_TYPE, detail: String(type ?? "").slice(0, 60) };
  }

  // Idempotency key. Without it a retried batch would double-count every event,
  // which would then inflate both the tiles and the risk score.
  const clientEventId = cleanString(raw?.client_event_id, 120);
  if (!clientEventId) return { ok: false, error: REJECT.MISSING_CLIENT_ID };

  const when = validateTimestamp(raw?.occurred_at ?? raw?.occurredAt, now);
  if (when.error) return { ok: false, error: when.error };

  const severity = severityFor(type);

  let meta = raw?.meta;
  if (meta != null && (typeof meta !== "object" || Array.isArray(meta))) {
    return { ok: false, error: REJECT.BAD_VALUE, detail: "meta must be an object" };
  }
  if (metaBytes(meta) > LIMITS.maxMetaBytes) {
    return { ok: false, error: REJECT.META_TOO_LARGE };
  }

  return {
    ok: true,
    event: {
      type,
      severity,
      occurred_at: when.at,
      client_event_id: clientEventId,
      // Carried, not trusted: the phone's own view of the clock gap is useful
      // evidence, and it is preserved under meta so a reviewer can see it.
      meta: { ...(meta || {}), clock_skew_seconds: when.skewSeconds },
    },
  };
}

/**
 * Validate one position ping.
 *
 * `lat`/`lng` are range-checked rather than clamped to the world: a coordinate
 * of 91 is a broken device or a crafted request, and quietly turning it into 90
 * would put a worker at the North Pole instead of rejecting the sample.
 */
export function normalisePing(raw, { now = new Date() } = {}) {
  const lat = typeof raw?.lat === "string" ? Number(raw.lat) : raw?.lat;
  const lng = typeof raw?.lng === "string" ? Number(raw.lng) : raw?.lng;

  if (!isFiniteNumber(lat) || !isFiniteNumber(lng)) {
    return { ok: false, error: REJECT.BAD_COORDINATE };
  }
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return { ok: false, error: REJECT.BAD_COORDINATE, detail: `${lat},${lng}` };
  }

  const when = validateTimestamp(raw?.recorded_at ?? raw?.recordedAt, now);
  if (when.error) return { ok: false, error: when.error };

  const clientEventId = cleanString(raw?.client_event_id, 120);
  if (!clientEventId) return { ok: false, error: REJECT.MISSING_CLIENT_ID };

  const battery = raw?.battery ?? raw?.battery_pct;
  const batteryNumber = battery == null || battery === "" ? null : Number(battery);
  if (batteryNumber != null && (!Number.isFinite(batteryNumber) || batteryNumber < 0 || batteryNumber > 100)) {
    return { ok: false, error: REJECT.BAD_BATTERY };
  }

  const optionalNumber = (value, min, max) => {
    if (value == null || value === "") return null;
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    return Math.max(min, Math.min(max, n));
  };

  const state = cleanString(raw?.state, 20);
  const ALLOWED_STATES = ["live", "offline", "no_gps"];

  return {
    ok: true,
    ping: {
      lat,
      lng,
      accuracy: optionalNumber(raw?.accuracy, 0, 100000),
      speed: optionalNumber(raw?.speed, 0, 1000),
      heading: optionalNumber(raw?.heading, 0, 360),
      battery_pct: batteryNumber == null ? null : Math.round(batteryNumber),
      provider: cleanString(raw?.provider, 40),
      // `no_gps` and `offline` are worth recording even with no coordinates, but
      // this table requires a position, so they arrive as events instead. A ping
      // without a position has nothing to store.
      state: ALLOWED_STATES.includes(state) ? state : "live",
      recorded_at: when.at,
      client_event_id: clientEventId,
      clock_skew_seconds: when.skewSeconds,
    },
  };
}

/**
 * Validate a whole batch.
 *
 * Returns the accepted rows plus the rejected ones with reasons. Rejections are
 * reported rather than silently dropped so the device can log them and a support
 * call can explain why a count does not match.
 */
export function normaliseBatch(body, { now = new Date() } = {}) {
  const problems = [];

  const rawEvents = Array.isArray(body?.events) ? body.events : [];
  const rawPings = Array.isArray(body?.pings) ? body.pings : [];

  if (rawEvents.length > LIMITS.maxEvents) {
    problems.push({ scope: "batch", error: REJECT.BAD_VALUE, detail: `at most ${LIMITS.maxEvents} events` });
  }
  if (rawPings.length > LIMITS.maxPings) {
    problems.push({ scope: "batch", error: REJECT.BAD_VALUE, detail: `at most ${LIMITS.maxPings} pings` });
  }

  const events = [];
  for (const [index, raw] of rawEvents.slice(0, LIMITS.maxEvents).entries()) {
    const result = normaliseEvent(raw, { now });
    if (result.ok) events.push(result.event);
    else problems.push({ scope: "event", index, ...result, ok: undefined });
  }

  const pings = [];
  for (const [index, raw] of rawPings.slice(0, LIMITS.maxPings).entries()) {
    const result = normalisePing(raw, { now });
    if (result.ok) pings.push(result.ping);
    else problems.push({ scope: "ping", index, ...result, ok: undefined });
  }

  return { events, pings, problems };
}