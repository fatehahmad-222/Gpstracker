import { describe, it, expect } from "vitest";

import {
  normaliseEvent,
  normalisePing,
  normaliseBatch,
  validateTimestamp,
  severityFor,
  LIMITS,
  REJECT,
  INGEST_EVENT_TYPES,
} from "@/lib/monitor/ingest";
import { SIGNAL_BY_KEY } from "@/lib/monitor/signals";

const NOW = new Date("2026-10-04T12:00:00Z");

function at(offsetSeconds) {
  return new Date(NOW.getTime() + offsetSeconds * 1000).toISOString();
}

function event(overrides = {}) {
  return {
    type: "power_off",
    occurred_at: at(0),
    client_event_id: "c1",
    ...overrides,
  };
}

function ping(overrides = {}) {
  return {
    lat: 32.4945,
    lng: 74.5229,
    recorded_at: at(0),
    client_event_id: "p1",
    ...overrides,
  };
}

describe("validateTimestamp", () => {
  it("accepts now", () => {
    expect(validateTimestamp(at(0), NOW)).toEqual({ at: at(0), skewSeconds: 0 });
  });

  it("keeps small skew, because the gap is itself a signal", () => {
    // A phone with a clock a few minutes out is normal, and the Alerts screen
    // reports the device/server gap as evidence. Rejecting it would destroy data.
    const result = validateTimestamp(at(-120), NOW);
    expect(result.error).toBeUndefined();
    expect(result.skewSeconds).toBe(-120);
  });

  it("refuses a timestamp far enough ahead to look forged", () => {
    expect(validateTimestamp(at(LIMITS.maxClockSkewSeconds + 60), NOW).error).toBe(
      REJECT.FUTURE_TIMESTAMP
    );
  });

  it("refuses a timestamp older than the replay window", () => {
    expect(validateTimestamp(at(-(LIMITS.maxEventAgeDays * 86400 + 60)), NOW).error).toBe(
      REJECT.STALE_TIMESTAMP
    );
  });

  it("accepts a timestamp exactly at the skew boundary", () => {
    expect(validateTimestamp(at(LIMITS.maxClockSkewSeconds), NOW).error).toBeUndefined();
  });

  it("refuses unparseable and missing values", () => {
    expect(validateTimestamp("not a date", NOW).error).toBe(REJECT.BAD_TIMESTAMP);
    expect(validateTimestamp(undefined, NOW).error).toBe(REJECT.BAD_TIMESTAMP);
    expect(validateTimestamp(null, NOW).error).toBe(REJECT.BAD_TIMESTAMP);
    expect(validateTimestamp({}, NOW).error).toBe(REJECT.BAD_TIMESTAMP);
  });

  it("accepts epoch milliseconds as well as ISO strings", () => {
    const result = validateTimestamp(NOW.getTime(), NOW);
    expect(result.skewSeconds).toBe(0);
  });
});

describe("severityFor", () => {
  it("takes severity from the catalogue, never from the request", () => {
    // A device that could pick its own severity could downgrade fake_gps to
    // medium and keep a critical accusation out of the queue.
    expect(severityFor("fake_gps")).toBe(SIGNAL_BY_KEY.fake_gps.severity);
    expect(severityFor("fake_gps")).toBe("critical");
  });

  it("returns null for a type that does not exist", () => {
    expect(severityFor("made_up")).toBeNull();
  });

  it("covers every type the database will accept", () => {
    expect(INGEST_EVENT_TYPES.length).toBeGreaterThan(0);
    for (const type of INGEST_EVENT_TYPES) {
      expect(severityFor(type)).toBeTruthy();
    }
  });
});

describe("normaliseEvent", () => {
  it("accepts a well-formed event", () => {
    const result = normaliseEvent(event(), { now: NOW });
    expect(result.ok).toBe(true);
    expect(result.event).toMatchObject({
      type: "power_off",
      severity: "medium",
      client_event_id: "c1",
    });
  });

  it("refuses an unknown type", () => {
    const result = normaliseEvent(event({ type: "rm_rf_slash" }), { now: NOW });
    expect(result).toMatchObject({ ok: false, error: REJECT.UNKNOWN_TYPE });
  });

  it("refuses an event with no idempotency key", () => {
    // Without one a retried batch double-counts, inflating tiles and risk scores.
    const result = normaliseEvent(event({ client_event_id: undefined }), { now: NOW });
    expect(result).toMatchObject({ ok: false, error: REJECT.MISSING_CLIENT_ID });
  });

  it("refuses an empty-string idempotency key", () => {
    expect(normaliseEvent(event({ client_event_id: "   " }), { now: NOW }).error).toBe(
      REJECT.MISSING_CLIENT_ID
    );
  });

  it("overrides any severity the client supplied", () => {
    const result = normaliseEvent(event({ type: "fake_gps", severity: "medium" }), { now: NOW });
    expect(result.event.severity).toBe("critical");
  });

  it("ignores any employee or company in the payload", () => {
    // Identity comes from the token; the body must not be able to speak for
    // another employee even if it tries.
    const result = normaliseEvent(
      event({ employee_id: "someone-else", company_id: "other-company" }),
      { now: NOW }
    );
    expect(result.ok).toBe(true);
    expect(result.event).not.toHaveProperty("employee_id");
    expect(result.event).not.toHaveProperty("company_id");
  });

  it("records the clock skew as evidence rather than discarding it", () => {
    const result = normaliseEvent(event({ occurred_at: at(-300) }), { now: NOW });
    expect(result.event.meta.clock_skew_seconds).toBe(-300);
  });

  it("refuses oversized metadata", () => {
    const result = normaliseEvent(event({ meta: { blob: "x".repeat(LIMITS.maxMetaBytes) } }), { now: NOW });
    expect(result.error).toBe(REJECT.META_TOO_LARGE);
  });

  it("refuses non-object metadata", () => {
    expect(normaliseEvent(event({ meta: "string" }), { now: NOW }).error).toBe(REJECT.BAD_VALUE);
    expect(normaliseEvent(event({ meta: [1, 2] }), { now: NOW }).error).toBe(REJECT.BAD_VALUE);
  });

  it("refuses circular metadata instead of crashing the batch", () => {
    const meta = {};
    meta.self = meta;
    expect(normaliseEvent(event({ meta }), { now: NOW }).error).toBe(REJECT.META_TOO_LARGE);
  });

  it("trims and length-caps the client id", () => {
    const result = normaliseEvent(event({ client_event_id: "  abc  " }), { now: NOW });
    expect(result.event.client_event_id).toBe("abc");
  });
});

describe("normalisePing", () => {
  it("accepts a well-formed ping", () => {
    const result = normalisePing(ping(), { now: NOW });
    expect(result.ok).toBe(true);
    expect(result.ping.lat).toBe(32.4945);
  });

  it("refuses coordinates outside the world", () => {
    // Clamping would put a worker at the North Pole; rejecting refuses the sample.
    expect(normalisePing(ping({ lat: 91 }), { now: NOW }).error).toBe(REJECT.BAD_COORDINATE);
    expect(normalisePing(ping({ lat: -91 }), { now: NOW }).error).toBe(REJECT.BAD_COORDINATE);
    expect(normalisePing(ping({ lng: 181 }), { now: NOW }).error).toBe(REJECT.BAD_COORDINATE);
    expect(normalisePing(ping({ lng: -181 }), { now: NOW }).error).toBe(REJECT.BAD_COORDINATE);
  });

  it("accepts the exact extremes of the valid range", () => {
    expect(normalisePing(ping({ lat: 90, lng: 180 }), { now: NOW }).ok).toBe(true);
    expect(normalisePing(ping({ lat: -90, lng: -180 }), { now: NOW }).ok).toBe(true);
  });

  it("refuses coordinates that are not numbers at all", () => {
    expect(normalisePing(ping({ lat: "north" }), { now: NOW }).error).toBe(REJECT.BAD_COORDINATE);
    expect(normalisePing(ping({ lat: null }), { now: NOW }).error).toBe(REJECT.BAD_COORDINATE);
    expect(normalisePing(ping({ lat: NaN }), { now: NOW }).error).toBe(REJECT.BAD_COORDINATE);
    expect(normalisePing(ping({ lat: Infinity }), { now: NOW }).error).toBe(REJECT.BAD_COORDINATE);
  });

  it("coerces numeric strings, because JSON clients vary", () => {
    const result = normalisePing(ping({ lat: "32.5", lng: "74.5" }), { now: NOW });
    expect(result.ok).toBe(true);
    expect(result.ping.lat).toBe(32.5);
  });

  it("refuses a battery outside 0-100", () => {
    expect(normalisePing(ping({ battery_pct: 101 }), { now: NOW }).error).toBe(REJECT.BAD_BATTERY);
    expect(normalisePing(ping({ battery_pct: -1 }), { now: NOW }).error).toBe(REJECT.BAD_BATTERY);
    expect(normalisePing(ping({ battery_pct: "full" }), { now: NOW }).error).toBe(REJECT.BAD_BATTERY);
  });

  it("accepts a missing battery but not a nonsense one", () => {
    expect(normalisePing(ping({ battery_pct: null }), { now: NOW }).ping.battery_pct).toBeNull();
    expect(normalisePing(ping({ battery_pct: "" }), { now: NOW }).ping.battery_pct).toBeNull();
    expect(normalisePing(ping({ battery_pct: 0 }), { now: NOW }).ping.battery_pct).toBe(0);
  });

  it("refuses a ping with no idempotency key", () => {
    expect(normalisePing(ping({ client_event_id: undefined }), { now: NOW }).error).toBe(
      REJECT.MISSING_CLIENT_ID
    );
  });

  it("clamps heading into 0-360 and passes nonsense through as null", () => {
    expect(normalisePing(ping({ heading: 400 }), { now: NOW }).ping.heading).toBe(360);
    expect(normalisePing(ping({ heading: -10 }), { now: NOW }).ping.heading).toBe(0);
    expect(normalisePing(ping({ heading: "north" }), { now: NOW }).ping.heading).toBeNull();
  });

  it("falls back to live for an unrecognised state", () => {
    expect(normalisePing(ping({ state: "live" }), { now: NOW }).ping.state).toBe("live");
    expect(normalisePing(ping({ state: "no_gps" }), { now: NOW }).ping.state).toBe("no_gps");
    expect(normalisePing(ping({ state: "teleported" }), { now: NOW }).ping.state).toBe("live");
  });

  it("refuses a forged future timestamp", () => {
    expect(normalisePing(ping({ recorded_at: at(99999) }), { now: NOW }).error).toBe(
      REJECT.FUTURE_TIMESTAMP
    );
  });
});

describe("normaliseBatch", () => {
  it("accepts a mixed batch", () => {
    const { events, pings, problems } = normaliseBatch(
      { events: [event(), event({ client_event_id: "c2" })], pings: [ping()] },
      { now: NOW }
    );
    expect(events).toHaveLength(2);
    expect(pings).toHaveLength(1);
    expect(problems).toHaveLength(0);
  });

  it("keeps the good rows when one row is bad", () => {
    // A phone buffering offline must not lose its whole history to one bad row.
    const { events, problems } = normaliseBatch(
      { events: [event(), event({ type: "nope" }), event({ client_event_id: "c3" })] },
      { now: NOW }
    );
    expect(events.map((e) => e.client_event_id)).toEqual(["c1", "c3"]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({ scope: "event", index: 1, error: REJECT.UNKNOWN_TYPE });
  });

  it("reports the index of each rejected row so a device can log it", () => {
    const { problems } = normaliseBatch(
      { pings: [ping(), ping({ lat: 999 }), ping({ client_event_id: undefined })] },
      { now: NOW }
    );
    expect(problems.map((p) => p.index)).toEqual([1, 2]);
    expect(problems.every((p) => p.scope === "ping")).toBe(true);
  });

  it("caps an oversized event list instead of processing it", () => {
    const many = Array.from({ length: LIMITS.maxEvents + 50 }, (_, i) =>
      event({ client_event_id: `c${i}` })
    );
    const { events, problems } = normaliseBatch({ events: many }, { now: NOW });
    expect(events).toHaveLength(LIMITS.maxEvents);
    expect(problems.some((p) => p.scope === "batch")).toBe(true);
  });

  it("caps an oversized ping list", () => {
    const many = Array.from({ length: LIMITS.maxPings + 10 }, (_, i) =>
      ping({ client_event_id: `p${i}` })
    );
    expect(normaliseBatch({ pings: many }, { now: NOW }).pings).toHaveLength(LIMITS.maxPings);
  });

  it("treats a missing body as empty rather than throwing", () => {
    expect(normaliseBatch(undefined, { now: NOW })).toMatchObject({ events: [], pings: [] });
    expect(normaliseBatch({ events: "not an array" }, { now: NOW }).events).toEqual([]);
  });

  it("handles an entirely empty batch", () => {
    const { events, pings, problems } = normaliseBatch({}, { now: NOW });
    expect({ events, pings, problems }).toEqual({ events: [], pings: [], problems: [] });
  });
});