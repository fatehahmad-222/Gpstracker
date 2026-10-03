import { describe, it, expect } from "vitest";
import {
  SIGNALS,
  SIGNAL_KEYS,
  SIGNAL_BY_KEY,
  SEVERITY_META,
  SEVERITY_ORDER,
  EVENT_TYPE_TO_SIGNAL,
  countsFromEvents,
  mergeSignalCounts,
  activeSignalKeys,
  highestSeverity,
  DEFAULT_VISIBLE_COLUMNS,
} from "@/lib/monitor/signals";
import {
  parseAndroidVersion,
  isUnsupported,
  hoursSinceSync,
  noSyncOver24h,
  hasSecondDevice,
  impliedSpeedKmh,
  detectImpossibleTravel,
  heartbeatGapMinutes,
  isMockFix,
  batteryState,
  deriveSignals,
} from "@/lib/monitor/signals-derive";

describe("signal catalogue", () => {
  it("gives every signal a unique key", () => {
    expect(new Set(SIGNAL_KEYS).size).toBe(SIGNAL_KEYS.length);
  });

  it("gives every signal a label", () => {
    for (const s of SIGNALS) expect(s.label, s.key).toBeTruthy();
  });

  it("uses only severities the theme defines", () => {
    // Regression guard: a signal with a severity missing from SEVERITY_META is
    // invisible to highestSeverity() and renders without styling.
    for (const s of SIGNALS) {
      expect(SEVERITY_ORDER[s.severity], `${s.key} -> ${s.severity}`).toBeDefined();
      expect(SEVERITY_META[s.severity], `${s.key} -> ${s.severity}`).toBeTruthy();
    }
  });

  it("gives every severity meta a full style set", () => {
    for (const [key, meta] of Object.entries(SEVERITY_META)) {
      expect(meta.label, key).toBeTruthy();
      expect(meta.pill, key).toBeTruthy();
      expect(meta.chip, key).toBeTruthy();
    }
  });

  it("indexes signals by key", () => {
    expect(SIGNAL_BY_KEY.fake_gps.label).toBeTruthy();
  });

  it("orders severities critical first", () => {
    expect(SEVERITY_ORDER.critical).toBeLessThan(SEVERITY_ORDER.high);
    expect(SEVERITY_ORDER.high).toBeLessThan(SEVERITY_ORDER.medium);
    expect(SEVERITY_ORDER.medium).toBeLessThan(SEVERITY_ORDER.low);
  });

  it("maps an event type to every signal it raises", () => {
    for (const s of SIGNALS) {
      for (const t of s.eventTypes || []) {
        expect(EVENT_TYPE_TO_SIGNAL[t], `${s.key} <- ${t}`).toContain(s.key);
      }
    }
  });

  it("exposes a default visible column set drawn from the catalogue", () => {
    expect(DEFAULT_VISIBLE_COLUMNS.length).toBeGreaterThan(0);
    for (const k of DEFAULT_VISIBLE_COLUMNS) expect(SIGNAL_KEYS).toContain(k);
  });
});

describe("countsFromEvents", () => {
  it("is zero for no events", () => {
    expect(countsFromEvents([]).force_stop).toBe(0);
  });

  it("counts events per signal", () => {
    expect(countsFromEvents([{ type: "force_stop" }, { type: "force_stop" }]).force_stop).toBe(2);
  });

  it("initialises every signal key so the table always has a column", () => {
    const counts = countsFromEvents([]);
    for (const k of SIGNAL_KEYS) expect(counts[k], k).toBe(0);
  });

  it("ignores unknown event types", () => {
    expect(() => countsFromEvents([{ type: "meteor_strike" }])).not.toThrow();
    expect(countsFromEvents([{ type: "meteor_strike" }]).force_stop).toBe(0);
  });

  it("ignores events with no type", () => {
    expect(countsFromEvents([{}]).fake_gps).toBe(0);
  });
});

describe("mergeSignalCounts", () => {
  // mergeSignalCounts expects the full shape countsFromEvents returns, because
  // it only overwrites keys already present.
  const base = () => countsFromEvents([]);

  it("overrides a stored count with its derived value", () => {
    expect(mergeSignalCounts({ ...base(), force_stop: 2 }, { force_stop: 1 }).force_stop).toBe(1);
  });

  it("carries derived-only signals through", () => {
    expect(mergeSignalCounts(base(), { no_sync_24h: 4 }).no_sync_24h).toBe(4);
  });

  it("normalises a boolean to 1 or 0", () => {
    expect(mergeSignalCounts(base(), { force_stop: true }).force_stop).toBe(1);
    expect(mergeSignalCounts(base(), { force_stop: false }).force_stop).toBe(0);
  });

  it("ignores unknown keys", () => {
    expect(mergeSignalCounts(base(), { not_a_signal: 9 }).not_a_signal).toBeUndefined();
  });

  it("ignores a null derived value", () => {
    expect(mergeSignalCounts(base(), { force_stop: null }).force_stop).toBe(0);
  });

  it("does not mutate its input", () => {
    const stored = base();
    mergeSignalCounts(stored, { force_stop: 7 });
    expect(stored.force_stop).toBe(0);
  });
});

describe("activeSignalKeys and highestSeverity", () => {
  it("lists only non-zero signals", () => {
    expect(activeSignalKeys({ force_stop: 0, fake_gps: 2 })).toEqual(["fake_gps"]);
  });

  it("reports nothing for a clean employee", () => {
    expect(activeSignalKeys({})).toEqual([]);
  });

  it("reports the highest severity present", () => {
    expect(highestSeverity({ battery_low: 1, fake_gps: 1 })).toBe("critical");
  });

  it("can report a low-severity signal", () => {
    expect(highestSeverity({ battery_low: 1 })).toBe("low");
  });

  it("returns null when nothing is wrong", () => {
    expect(highestSeverity({})).toBeNull();
  });

  it("ignores zero-valued signals", () => {
    expect(highestSeverity({ fake_gps: 0 })).toBeNull();
  });
});

describe("parseAndroidVersion", () => {
  it("parses a plain version to its major number", () => {
    expect(parseAndroidVersion("13")).toBe(13);
  });

  it("takes the major from a dotted version", () => {
    expect(parseAndroidVersion("11.0.30")).toBe(11);
  });

  it("ignores a build suffix", () => {
    expect(parseAndroidVersion("12 (API 31)")).toBe(12);
  });

  it("returns null for an unparseable value", () => {
    expect(parseAndroidVersion("unknown")).toBeNull();
  });

  it("returns null for a missing value", () => {
    expect(parseAndroidVersion(null)).toBeNull();
  });
});

describe("isUnsupported", () => {
  it("flags Android below the minimum", () => {
    expect(isUnsupported("9", 14)).toBe(true);
  });

  it("accepts Android at the minimum", () => {
    expect(isUnsupported("14", 14)).toBe(false);
  });

  it("accepts a newer Android", () => {
    expect(isUnsupported("15", 14)).toBe(false);
  });

  it("treats an unknown version as not unsupported", () => {
    expect(isUnsupported(null, 14)).toBe(false);
  });
});

describe("sync age", () => {
  it("reports fractional hours since sync", () => {
    const now = Date.parse("2026-10-03T12:00:00.000Z");
    expect(hoursSinceSync("2026-10-03T09:00:00.000Z", now)).toBeCloseTo(3, 6);
  });

  it("is Infinity for a device that never synced", () => {
    expect(hoursSinceSync(null)).toBe(Infinity);
  });

  it("flags a device that never synced", () => {
    expect(noSyncOver24h(null)).toBe(true);
  });

  it("flags a stale device", () => {
    const now = Date.parse("2026-10-03T12:00:00.000Z");
    expect(noSyncOver24h("2026-10-02T06:00:00.000Z", now)).toBe(true);
  });

  it("does not flag a fresh sync", () => {
    const now = Date.parse("2026-10-03T12:00:00.000Z");
    expect(noSyncOver24h("2026-10-03T11:00:00.000Z", now)).toBe(false);
  });
});

describe("hasSecondDevice", () => {
  // The mobile app classifies this server-side and reports it as a
  // `second_device` event, so this only windows what has already arrived.
  it("detects a reported second device inside the window", () => {
    const now = Date.parse("2026-10-03T12:00:00.000Z");
    expect(hasSecondDevice([{ type: "second_device", occurred_at: "2026-10-03T10:00:00.000Z" }], now)).toBe(true);
  });

  it("ignores a second device reported outside the window", () => {
    const now = Date.parse("2026-10-03T12:00:00.000Z");
    expect(hasSecondDevice([{ type: "second_device", occurred_at: "2026-09-01T10:00:00.000Z" }], now)).toBe(false);
  });

  it("ignores unrelated events", () => {
    const now = Date.parse("2026-10-03T12:00:00.000Z");
    expect(hasSecondDevice([{ type: "app_login", occurred_at: "2026-10-03T10:00:00.000Z" }], now)).toBe(false);
  });

  it("is false with no events", () => {
    expect(hasSecondDevice([], Date.now())).toBe(false);
  });
});

describe("impossible travel", () => {
  it("computes speed between two pings", () => {
    const from = { lat: 32.4945, lng: 74.5229, recorded_at: "2026-10-03T10:00:00.000Z" };
    const to = { lat: 32.6, lng: 74.5229, recorded_at: "2026-10-03T10:10:00.000Z" };
    expect(impliedSpeedKmh(from, to)).toBeGreaterThan(50);
  });

  it("is zero over a zero time gap", () => {
    const ping = { lat: 32.4945, lng: 74.5229, recorded_at: "2026-10-03T10:00:00.000Z" };
    expect(impliedSpeedKmh(ping, ping)).toBe(0);
  });

  it("flags a jump across the city in minutes", () => {
    const pings = [
      { lat: 32.4945, lng: 74.5229, recorded_at: "2026-10-03T10:00:00.000Z" },
      { lat: 32.6, lng: 74.7, recorded_at: "2026-10-03T10:02:00.000Z" },
    ];
    const result = detectImpossibleTravel(pings);
    expect(result.detected).toBe(true);
    expect(result.speed_kmh).toBeGreaterThan(90);
  });

  it("reports the offending pair", () => {
    const a = { lat: 32.4945, lng: 74.5229, recorded_at: "2026-10-03T10:00:00.000Z" };
    const b = { lat: 32.6, lng: 74.7, recorded_at: "2026-10-03T10:02:00.000Z" };
    expect(detectImpossibleTravel([a, b]).from).toBe(a);
  });

  it("does not flag a normal walk", () => {
    const pings = [
      { lat: 32.4945, lng: 74.5229, recorded_at: "2026-10-03T10:00:00.000Z" },
      { lat: 32.4946, lng: 74.523, recorded_at: "2026-10-03T10:05:00.000Z" },
    ];
    expect(detectImpossibleTravel(pings).detected).toBe(false);
  });

  it("does not flag a single ping", () => {
    expect(detectImpossibleTravel([{ lat: 32.4945, lng: 74.5229 }]).detected).toBe(false);
  });

  it("honours a custom threshold", () => {
    const pings = [
      { lat: 32.4945, lng: 74.5229, recorded_at: "2026-10-03T10:00:00.000Z" },
      { lat: 32.5, lng: 74.53, recorded_at: "2026-10-03T10:05:00.000Z" },
    ];
    expect(detectImpossibleTravel(pings, 5).detected).toBe(true);
  });
});

describe("heartbeat, battery and mock fixes", () => {
  it("reports the gap once it passes the threshold", () => {
    const now = Date.parse("2026-10-03T12:00:00.000Z");
    expect(heartbeatGapMinutes("2026-10-03T11:00:00.000Z", now, 15)).toBe(60);
  });

  it("reports zero below the threshold", () => {
    const now = Date.parse("2026-10-03T12:00:00.000Z");
    expect(heartbeatGapMinutes("2026-10-03T11:55:00.000Z", now, 15)).toBe(0);
  });

  it("is Infinity for a device that never reported", () => {
    expect(heartbeatGapMinutes(null)).toBe(Infinity);
  });

  it("classifies battery level", () => {
    expect(batteryState(10)).toBe("low");
    expect(batteryState(30)).toBe("medium");
    expect(batteryState(80)).toBe("ok");
  });

  it("reports an unknown battery rather than guessing", () => {
    expect(batteryState(null)).toBe("unknown");
  });

  it("detects a mock location fix", () => {
    expect(isMockFix({ is_mock: true })).toBe(true);
    expect(isMockFix({ is_mock: false })).toBe(false);
    expect(isMockFix({})).toBe(false);
    expect(isMockFix(null)).toBe(false);
  });
});

describe("deriveSignals", () => {
  const now = Date.parse("2026-10-03T12:00:00.000Z");

  it("derives no_sync_24h for a stale device", () => {
    expect(deriveSignals({}, { last_sync_at: "2026-10-01T12:00:00.000Z" }, [], { now }).no_sync_24h).toBe(1);
  });

  it("derives unsupported for an old Android", () => {
    expect(deriveSignals({}, { android_version: "9" }, [], { now }).unsupported).toBe(1);
  });

  it("derives second_device from a reported event", () => {
    const events = [{ type: "second_device", occurred_at: "2026-10-03T10:00:00.000Z" }];
    expect(deriveSignals({}, {}, events, { now }).second_device).toBe(1);
  });

  it("derives nothing for a healthy device", () => {
    const derived = deriveSignals(
      { },
      { android_version: "15", last_sync_at: new Date(now).toISOString() },
      [],
      { now }
    );
    expect(derived.no_sync_24h).toBe(0);
    expect(derived.unsupported).toBe(0);
    expect(derived.second_device).toBe(0);
  });

  it("honours a company minimum Android version", () => {
    const opts = { now, companySettings: { min_android_version: 16 } };
    expect(deriveSignals({}, { android_version: "15" }, [], opts).unsupported).toBe(1);
  });

  it("returns only 0 or 1 flags", () => {
    const derived = deriveSignals({}, { android_version: "9", last_sync_at: null }, [], { now });
    for (const [k, v] of Object.entries(derived)) {
      expect([0, 1], k).toContain(v);
    }
  });

  it("tolerates a missing device record", () => {
    expect(() => deriveSignals({}, null, [], { now })).not.toThrow();
    expect(deriveSignals({}, null, [], { now }).no_sync_24h).toBe(1);
  });

  it("tolerates no employee record", () => {
    expect(() => deriveSignals(null, {}, [], { now })).not.toThrow();
  });
});