import { describe, it, expect } from "vitest";

import {
  VIOLATION_CATEGORIES,
  DEFAULT_CATEGORY,
  categoryForSignal,
  canTransition,
  shouldRaiseViolation,
  violationKey,
  violationsFromEvents,
  summariseViolations,
  categoryBreakdown,
  alertTiles,
  riskiest,
} from "@/lib/monitor/alerts";
import { countsFromEvents, mergeSignalCounts } from "@/lib/monitor/signals";
import { computeRisk } from "@/lib/monitor/risk";
import { SIGNAL_BY_KEY } from "@/lib/monitor/signals";
import { violationLabel, violationCategory, RAISED_VIOLATION_TYPES } from "@/lib/monitor/alerts";

const event = (over = {}) => ({
  id: `e-${Math.random()}`,
  employee_id: "emp-1",
  type: "location_off",
  occurred_at: "2026-09-25T04:00:00Z",
  reported_at: "2026-09-25T04:00:05Z",
  ...over,
});

describe("categoryForSignal", () => {
  it("uses the signal's own category", () => {
    expect(categoryForSignal("fake_gps")).toBe("Possible Fraud");
    expect(categoryForSignal("location_off")).toBe("Tracking Lost");
  });

  it("files an uncategorised signal under Other", () => {
    expect(categoryForSignal("battery_low")).toBe(DEFAULT_CATEGORY);
  });

  it("returns Other for a key that does not exist", () => {
    expect(categoryForSignal("nonsense")).toBe("Other");
  });

  it("only ever returns a declared category", () => {
    for (const key of ["data_cleared", "no_sync_24h", "unsupported", "second_device", "time_diff"]) {
      expect(VIOLATION_CATEGORIES).toContain(categoryForSignal(key));
    }
  });
});

describe("shouldRaiseViolation", () => {
  it("raises medium and above", () => {
    expect(shouldRaiseViolation(event({ type: "location_off" }))).toBe(true); // high
    expect(shouldRaiseViolation(event({ type: "time_diff" }))).toBe(true); // medium
  });

  it("does not raise low-severity noise", () => {
    // A battery warning is not an accusation against an employee.
    expect(shouldRaiseViolation(event({ type: "battery_low" }))).toBe(false);
    expect(shouldRaiseViolation(event({ type: "admin_logout" }))).toBe(false);
    expect(shouldRaiseViolation(event({ type: "old_app" }))).toBe(false);
  });

  it("ignores event types with no signal mapping", () => {
    expect(shouldRaiseViolation(event({ type: "totally_unknown" }))).toBe(false);
    expect(shouldRaiseViolation({})).toBe(false);
    expect(shouldRaiseViolation(null)).toBe(false);
  });
});

describe("canTransition", () => {
  it("requires acknowledgement before resolution", () => {
    expect(canTransition("open", "acknowledged")).toBe(true);
    // Jumping straight from open to resolved would erase who ignored it.
    expect(canTransition("open", "resolved")).toBe(false);
  });

  it("allows reopening something acknowledged", () => {
    expect(canTransition("acknowledged", "open")).toBe(true);
    expect(canTransition("acknowledged", "resolved")).toBe(true);
  });

  it("treats a no-op transition as allowed", () => {
    expect(canTransition("open", "open")).toBe(true);
    expect(canTransition("resolved", "resolved")).toBe(true);
  });

  it("refuses to unresolve", () => {
    expect(canTransition("resolved", "open")).toBe(false);
    expect(canTransition("resolved", "acknowledged")).toBe(false);
  });

  it("refuses an unknown status", () => {
    expect(canTransition("open", "deleted")).toBe(false);
    expect(canTransition("nonsense", "open")).toBe(false);
  });
});

describe("violationsFromEvents", () => {
  it("opens one violation per employee per fault", () => {
    const { rows } = violationsFromEvents({
      companyId: "c1",
      events: [
        event({ id: "a", type: "location_off" }),
        event({ id: "b", type: "location_off" }),
        event({ id: "c", type: "force_stop" }),
      ],
    });
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.type).sort()).toEqual(["force_stop", "location_off"]);
  });

  it("keeps different employees apart", () => {
    const { rows } = violationsFromEvents({
      companyId: "c1",
      events: [
        event({ id: "a", employee_id: "emp-1", type: "location_off" }),
        event({ id: "b", employee_id: "emp-2", type: "location_off" }),
      ],
    });
    expect(rows).toHaveLength(2);
  });

  it("does not re-raise a fault that is already open", () => {
    const { rows, skipped } = violationsFromEvents({
      companyId: "c1",
      events: [event({ id: "new", type: "location_off" })],
      open: [
        { employee_id: "emp-1", type: "location_off", status: "open" },
        { employee_id: "emp-1", type: "force_stop", status: "acknowledged" },
      ],
    });
    expect(rows).toHaveLength(0);
    expect(skipped).toBe(1);
  });

  it("re-raises once the old violation is resolved", () => {
    // An unresolved-but-resolved row is history, not a reason to stay silent.
    const { rows } = violationsFromEvents({
      companyId: "c1",
      events: [event({ type: "location_off" })],
      open: [{ employee_id: "emp-1", type: "location_off", status: "resolved" }],
    });
    expect(rows).toHaveLength(1);
  });

  it("carries the signal's category and severity", () => {
    const { rows } = violationsFromEvents({
      companyId: "c1",
      events: [event({ type: "fake_gps" })],
    });
    expect(rows[0].category).toBe("Possible Fraud");
    expect(rows[0].severity).toBe("critical");
    expect(rows[0].status).toBe("open");
    expect(rows[0].company_id).toBe("c1");
  });

  it("keeps the earliest occurrence when collapsing a burst", () => {
    const { rows } = violationsFromEvents({
      companyId: "c1",
      events: [
        event({ id: "later", type: "location_off", occurred_at: "2026-09-25T05:00:00Z" }),
        event({ id: "earlier", type: "location_off", occurred_at: "2026-09-25T04:00:00Z" }),
      ],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].occurred_at).toBe("2026-09-25T04:00:00Z");
  });

  it("skips low-severity events but still counts them as skipped", () => {
    const { rows, skipped } = violationsFromEvents({
      companyId: "c1",
      events: [event({ type: "battery_low" })],
    });
    expect(rows).toHaveLength(0);
    expect(skipped).toBe(1);
  });
});

describe("summariseViolations", () => {
  const rows = [
    { status: "open", severity: "critical", category: "Possible Fraud" },
    { status: "open", severity: "high", category: "Tracking Lost" },
    { status: "acknowledged", severity: "high", category: "Tracking Lost" },
    { status: "resolved", severity: "medium", category: "Other" },
  ];

  it("counts each status", () => {
    const s = summariseViolations(rows);
    expect(s.total).toBe(4);
    expect(s.open).toBe(2);
    expect(s.acknowledged).toBe(1);
    expect(s.resolved).toBe(1);
  });

  it("treats acknowledged as still needing attention", () => {
    expect(summariseViolations(rows).unresolved).toBe(3);
  });

  it("counts severities separately from statuses", () => {
    const s = summariseViolations(rows);
    expect(s.critical).toBe(1);
    expect(s.high).toBe(2);
    expect(s.medium).toBe(1);
  });

  it("groups by category", () => {
    expect(summariseViolations(rows).by_category["Tracking Lost"]).toBe(2);
  });

  it("handles an empty queue", () => {
    const s = summariseViolations([]);
    expect(s.total).toBe(0);
    expect(s.unresolved).toBe(0);
  });
});

describe("categoryBreakdown", () => {
  it("ranks by what still needs attention, not by raw volume", () => {
    const rows = [
      { status: "resolved", severity: "medium", category: "Other" },
      { status: "resolved", severity: "medium", category: "Other" },
      { status: "open", severity: "high", category: "Tracking Lost" },
    ];
    const [first] = categoryBreakdown(rows);
    expect(first.category).toBe("Tracking Lost");
    expect(first.unresolved).toBe(1);
  });

  it("omits categories with nothing in them", () => {
    const rows = [{ status: "open", severity: "high", category: "Tracking Lost" }];
    const names = categoryBreakdown(rows).map((c) => c.category);
    expect(names).toEqual(["Tracking Lost"]);
    expect(names).not.toContain("Data Loss");
  });
});

describe("alertTiles", () => {
  it("emits one tile per categorised signal", () => {
    const tiles = alertTiles({});
    expect(tiles.length).toBeGreaterThanOrEqual(8);
    expect(new Set(tiles.map((t) => t.key)).size).toBe(tiles.length);
  });

  it("counts the signals it is given and defaults the rest to zero", () => {
    const tiles = alertTiles({ data_cleared: 2 });
    expect(tiles.find((t) => t.key === "data_cleared").count).toBe(2);
    expect(tiles.find((t) => t.key === "location_off").count).toBe(0);
  });

  it("shows the eight dashboard tiles, not all twenty-four signals", () => {
    const tiles = alertTiles({});
    expect(tiles).toHaveLength(8);
    // Every signal is categorised now, so a tile is identified by its hint.
    expect(tiles.every((t) => t.hint)).toBe(true);
    expect(tiles.some((t) => t.key === "fake_gps")).toBe(false);
  });

  it("orders the most severe first", () => {
    const tiles = alertTiles({});
    expect(tiles[0].severity).toBe("critical");
  });

  it("gives every tile a label and a hint for the tooltip", () => {
    for (const tile of alertTiles({})) {
      expect(tile.label).toBeTruthy();
      expect(tile.hint).toBeTruthy();
    }
  });
});

describe("riskiest", () => {
  it("scores with the shared weighting rather than its own", () => {
    const counts = { fake_gps: 1 };
    const [top] = riskiest({ "emp-1": counts });
    expect(top.score).toBe(computeRisk(counts).score);
  });

  it("ranks by score and caps the list", () => {
    const rows = riskiest(
      { "emp-1": { battery_low: 5 }, "emp-2": { fake_gps: 2 }, "emp-3": { location_off: 1 } },
      { limit: 2 }
    );
    expect(rows).toHaveLength(2);
    expect(rows[0].employee_id).toBe("emp-2");
    expect(rows[0].score).toBeGreaterThan(rows[1].score);
  });

  it("drops anyone with nothing raised", () => {
    expect(riskiest({ "emp-1": {}, "emp-2": { battery_low: 0 } })).toEqual([]);
  });
});

describe("mergeSignalCounts — derived keys that are scored but have no column", () => {
  it("keeps no_clock_in, which has a risk weight but no event type", () => {
    const merged = mergeSignalCounts(countsFromEvents([]), { no_clock_in: 1 });
    expect(merged.no_clock_in).toBe(1);
    // And it has to reach the score, or every risk figure understates absence.
    expect(computeRisk(merged).score).toBe(1);
  });

  it("still ignores a derived key nobody scores", () => {
    const merged = mergeSignalCounts(countsFromEvents([]), { not_a_signal: 3 });
    expect("not_a_signal" in merged).toBe(false);
  });

  it("coerces a boolean to 0 or 1", () => {
    expect(mergeSignalCounts(countsFromEvents([]), { no_clock_in: true }).no_clock_in).toBe(1);
    expect(mergeSignalCounts(countsFromEvents([]), { no_clock_in: false }).no_clock_in).toBe(0);
  });
});

describe("violationKey", () => {
  it("is stable and employee-scoped", () => {
    expect(violationKey("emp-1", "location_off")).toBe("emp-1:location_off");
    expect(violationKey("emp-2", "location_off")).not.toBe(violationKey("emp-1", "location_off"));
  });
});
describe("seed data stays in step with the signal catalogue", () => {
  // scripts/seed-data.mjs has to stay import-free so node can load it directly,
  // so its severity and category maps are copies. These assertions are what stop
  // the copies going stale.
  it("agrees on severity for every event type", async () => {
    const { EVENT_SEVERITY } = await import("../../scripts/seed-data.mjs");
    for (const [key, signal] of Object.entries(SIGNAL_BY_KEY)) {
      if (!signal.eventTypes?.length) continue;
      for (const type of signal.eventTypes) {
        if (EVENT_SEVERITY[type] === undefined) continue;
        expect({ type, severity: EVENT_SEVERITY[type] }).toEqual({
          type,
          severity: signal.severity,
        });
      }
    }
  });

  it("agrees on category for every event type", async () => {
    const { EVENT_CATEGORY } = await import("../../scripts/seed-data.mjs");
    for (const [key, signal] of Object.entries(SIGNAL_BY_KEY)) {
      if (EVENT_CATEGORY[key] === undefined) continue;
      expect({ key, category: EVENT_CATEGORY[key] }).toEqual({
        key,
        category: signal.category,
      });
    }
  });

  it("only seeds categories the alerts module knows about", async () => {
    const { EVENT_CATEGORY } = await import("../../scripts/seed-data.mjs");
    for (const category of Object.values(EVENT_CATEGORY)) {
      expect(VIOLATION_CATEGORIES).toContain(category);
    }
  });

  it("covers every signal with a category", async () => {
    const { EVENT_CATEGORY } = await import("../../scripts/seed-data.mjs");
    for (const key of Object.keys(SIGNAL_BY_KEY)) {
      expect(EVENT_CATEGORY[key]).toBeTruthy();
    }
  });
});

describe("seed event keys are real signal keys", () => {
  // Catches the other direction of drift: a typo in the seed maps would
  // silently seed nothing, because no signal would ever match the event type.
  it("every seeded event type resolves to a signal", async () => {
    const { EVENT_SEVERITY, EVENT_CATEGORY } = await import("../../scripts/seed-data.mjs");
    for (const type of Object.keys(EVENT_SEVERITY)) {
      expect({ type, known: Boolean(SIGNAL_BY_KEY[type]) }).toEqual({ type, known: true });
    }
    for (const type of Object.keys(EVENT_CATEGORY)) {
      expect({ type, known: Boolean(SIGNAL_BY_KEY[type]) }).toEqual({ type, known: true });
    }
  });
});

describe("server-raised violation types", () => {
  // The scheduled jobs in 0010 insert these straight into `violations`, so they
  // reach the queue without ever touching device_events or SIGNAL_BY_KEY.
  it("labels every type the SQL jobs raise", () => {
    for (const type of ["no_checkout", "idle_no_movement", "presence_check_missed", "no_clock_in"]) {
      expect(violationLabel(type)).not.toBe(type);
      expect(violationCategory(type)).toBe("Attendance");
    }
  });

  it("files them under the Attendance category the filter offers", () => {
    expect(VIOLATION_CATEGORIES).toContain("Attendance");
  });

  it("keeps them out of the signal catalogue so tiles cannot count them", () => {
    // If these entered SIGNAL_BY_KEY, countsFromEvents would look for event
    // types that never arrive and the tile totals would drift.
    for (const type of Object.keys(RAISED_VIOLATION_TYPES)) {
      expect(SIGNAL_BY_KEY[type]).toBeUndefined();
    }
  });

  it("still labels device-derived violations", () => {
    expect(violationLabel("fake_gps")).toBe(SIGNAL_BY_KEY.fake_gps.label);
  });

  it("falls back to the raw type for anything unknown", () => {
    expect(violationLabel("mystery_signal")).toBe("mystery_signal");
  });
});
