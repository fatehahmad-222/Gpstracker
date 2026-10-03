import { describe, it, expect } from "vitest";

import {
  attendanceRate,
  headlineKpis,
  commandCenterGroups,
  riskBoard,
  buildDashboard,
} from "@/lib/monitor/dashboard";

/** Minimal derived-day row, shaped like `deriveDay` output. */
function day(status, extra = {}) {
  return {
    status,
    punctuality: status === "late" ? "late" : "on_time",
    early_exit: false,
    overtime_seconds: 0,
    device_offline: false,
    department_name: null,
    ...extra,
  };
}

function violation(overrides = {}) {
  return {
    id: Math.random().toString(36).slice(2),
    employee_id: "e1",
    type: "fake_gps",
    category: "Possible Fraud",
    severity: "critical",
    status: "open",
    occurred_at: "2026-10-04T09:00:00Z",
    ...overrides,
  };
}

describe("attendanceRate", () => {
  it("measures present against employees whose shift has started", () => {
    // 10 total, 3 have not started their shift yet, so only 7 are eligible.
    const rate = attendanceRate({ total: 10, present: 7, shift_not_started: 3 });
    expect(rate).toEqual({ pct: 100, present: 7, denominator: 7 });
  });

  it("excludes not-yet-started employees rather than calling them absent", () => {
    // The whole point: an 06:00 dashboard should not report everyone absent.
    const rate = attendanceRate({ total: 20, present: 0, absent: 0, shift_not_started: 20 });
    expect(rate).toEqual({ pct: 0, present: 0, denominator: 0 });
  });

  it("reports the denominator alongside the percentage", () => {
    const rate = attendanceRate({ total: 8, present: 5, shift_not_started: 0 });
    expect(rate.pct).toBe(63); // 5/8 = 62.5, rounded
    expect(rate.denominator).toBe(8);
  });

  it("does not divide by zero on an empty company", () => {
    expect(attendanceRate({})).toEqual({ pct: 0, present: 0, denominator: 0 });
    expect(attendanceRate()).toEqual({ pct: 0, present: 0, denominator: 0 });
  });
});

describe("headlineKpis", () => {
  it("counts open violations as everything not resolved", () => {
    const kpis = headlineKpis({
      violations: [
        violation({ status: "open" }),
        violation({ status: "acknowledged" }),
        violation({ status: "resolved" }),
      ],
    });
    const open = kpis.find((k) => k.key === "violations");
    expect(open.value).toBe(2);
    expect(open.hint).toBe("1 resolved");
  });

  it("treats acknowledged as still needing attention", () => {
    // Acknowledged means someone owns it, not that it is finished.
    const kpis = headlineKpis({ violations: [violation({ status: "acknowledged" })] });
    expect(kpis.find((k) => k.key === "violations").value).toBe(1);
  });

  it("flags late with the amber accent and zero with slate", () => {
    const quiet = headlineKpis({ summary: { total: 5, late: 0 } });
    expect(quiet.find((k) => k.key === "late").accent).toBe("slate");

    const busy = headlineKpis({ summary: { total: 5, late: 2 } });
    expect(busy.find((k) => k.key === "late").accent).toBe("amber");
  });

  it("turns the attendance accent red only when it is genuinely low", () => {
    const band = (present, total) =>
      headlineKpis({ summary: { total, present } }).find((k) => k.key === "attendance_rate").accent;

    expect(band(9, 10)).toBe("green");
    expect(band(8, 10)).toBe("amber");
    expect(band(5, 10)).toBe("red");
  });

  it("counts devices that are not online", () => {
    const kpis = headlineKpis({
      devices: [
        { status: "online" },
        { status: "offline" },
        { status: "blocked" },
        { status: null },
      ],
    });
    const deviceKpi = kpis.find((k) => k.key === "devices");
    expect(deviceKpi.value).toBe(2);
    expect(deviceKpi.hint).toBe("4 registered");
  });

  it("counts only pending leave requests", () => {
    const kpis = headlineKpis({
      leaves: [
        { status: "pending" },
        { status: "pending" },
        { status: "approved" },
        { status: "rejected" },
      ],
    });
    expect(kpis.find((k) => k.key === "leaves").value).toBe(2);
  });

  it("returns a stable set of eight cards when given nothing", () => {
    expect(headlineKpis()).toHaveLength(8);
  });
});

describe("commandCenterGroups", () => {
  it("omits resolved work and low severity noise", () => {
    const groups = commandCenterGroups([
      violation({ status: "resolved", severity: "critical" }),
      violation({ status: "open", severity: "low" }),
      violation({ status: "open", severity: "high" }),
    ]);

    const all = groups.flatMap((g) => g.rows);
    expect(all).toHaveLength(1);
    expect(all[0].severity).toBe("high");
  });

  it("orders groups worst first", () => {
    const groups = commandCenterGroups([
      violation({ severity: "medium" }),
      violation({ severity: "critical" }),
      violation({ severity: "high" }),
    ]);
    expect(groups.map((g) => g.key)).toEqual(["critical", "high", "medium"]);
  });

  it("sorts within a severity newest first", () => {
    const groups = commandCenterGroups([
      violation({ id: "a", occurred_at: "2026-10-01T09:00:00Z" }),
      violation({ id: "b", occurred_at: "2026-10-04T09:00:00Z" }),
      violation({ id: "c", occurred_at: "2026-10-02T09:00:00Z" }),
    ]);
    expect(groups[0].rows.map((r) => r.id)).toEqual(["b", "c", "a"]);
  });

  it("labels server-raised violations rather than showing snake_case", () => {
    const groups = commandCenterGroups([
      violation({ type: "no_checkout", category: "Attendance", severity: "medium" }),
    ]);
    expect(groups[2].rows[0].label).toBe("No check-out");
  });

  it("prefers a label already supplied by the server layer", () => {
    const groups = commandCenterGroups([violation({ label: "Already labelled" })]);
    expect(groups[0].rows[0].label).toBe("Already labelled");
  });

  it("caps rows per group but keeps the full count", () => {
    const groups = commandCenterGroups(
      Array.from({ length: 9 }, (_, i) => violation({ id: `v${i}` })),
      6
    );
    expect(groups[0].count).toBe(9);
    expect(groups[0].rows).toHaveLength(6);
  });

  it("files an unknown severity as needing review instead of dropping it", () => {
    // Losing a violation because its severity was unrecognised would be the
    // worst possible failure for this card.
    const groups = commandCenterGroups([violation({ severity: "severe" })]);
    expect(groups[2].count).toBe(1);
  });

  it("returns empty groups when there is nothing open", () => {
    const groups = commandCenterGroups([]);
    expect(groups.every((g) => g.count === 0)).toBe(true);
  });
});

describe("riskBoard", () => {
  const people = new Map([["e1", { emp_code: "EMP-1", name: "Ada", department_name: "Field" }]]);

  it("accumulates every event, not just the last one", () => {
    // 20 repeats of a weight-4 signal scores 80. Counting one event at a time
    // and merging the results would score only the final event at 4, because
    // every earlier count gets overwritten by a zero.
    const events = Array.from({ length: 20 }, () => ({ employee_id: "e1", type: "force_stop" }));
    const [row] = riskBoard({ events, people });
    expect(row.score).toBe(80);
    expect(row.reasons[0].count).toBe(20);
  });

  it("excludes employees with no scored signals", () => {
    const events = [{ employee_id: "e1", type: "battery_low" }];
    // battery_low has weight 1, so it does score; use an unmapped type instead.
    expect(riskBoard({ events: [{ employee_id: "e1", type: "not_a_signal" }], people })).toEqual([]);
  });

  it("sorts by score descending", () => {
    const many = new Map([
      ["e1", { emp_code: "A", name: "Ada" }],
      ["e2", { emp_code: "B", name: "Ben" }],
    ]);
    const events = [
      ...Array.from({ length: 5 }, () => ({ employee_id: "e1", type: "fake_gps" })),
      { employee_id: "e2", type: "power_off" },
    ];
    expect(riskBoard({ events, people: many }).map((r) => r.employee_id)).toEqual(["e1", "e2"]);
  });

  it("explains itself with the top three weighted signals", () => {
    const events = [
      { employee_id: "e1", type: "fake_gps" },
      { employee_id: "e1", type: "power_off" },
      { employee_id: "e1", type: "dead_zone" },
      { employee_id: "e1", type: "battery_low" },
    ];
    const [row] = riskBoard({ events, people });
    expect(row.reasons).toHaveLength(3);
    expect(row.reasons[0].key).toBe("fake_gps");
    expect(row.reasons[0].label).toBe("Fake GPS");
  });

  it("honours company risk weights from settings", () => {
    const events = [{ employee_id: "e1", type: "power_off" }];
    expect(riskBoard({ events, people })[0].score).toBe(2);
    // An admin who does not care about power-off can zero it out.
    const retuned = riskBoard({ events, people, settings: { risk_weights: { power_off: 0 } } });
    expect(retuned).toEqual([]);
  });

  it("names an employee it has no record of rather than rendering a blank", () => {
    const [row] = riskBoard({ events: [{ employee_id: "ghost", type: "fake_gps" }], people });
    expect(row.name).toBe("Unknown employee");
  });

  it("returns a JSON-safe band", () => {
    // riskBand's top entry has max: Infinity, which JSON serialises to null.
    const [row] = riskBoard({ events: [{ employee_id: "e1", type: "fake_gps" }], people });
    expect(Object.keys(row.band).sort()).toEqual(["className", "key", "label"]);
  });

  it("caps the board at the requested size", () => {
    const events = ["e1", "e2", "e3", "e4"].map((id) => ({ employee_id: id, type: "power_off" }));
    expect(riskBoard({ events, people: new Map(), limit: 2 })).toHaveLength(2);
  });
});

describe("buildDashboard", () => {
  it("assembles every band from one pass of rows", () => {
    const dash = buildDashboard({
      date: "2026-10-04",
      days: [day("present"), day("late"), day("absent"), day("shift_not_started")],
      violations: [violation()],
      events: [{ employee_id: "e1", type: "fake_gps" }],
      leaves: [{ status: "pending" }],
      devices: [{ status: "online" }],
      openSessions: [{ id: "s1" }],
    });

    expect(dash.date).toBe("2026-10-04");
    expect(dash.summary.total).toBe(4);
    expect(dash.kpis).toHaveLength(8);
    expect(dash.tiles.length).toBeGreaterThan(0);
    expect(dash.command_center[0].count).toBe(1);
    expect(dash.risk).toHaveLength(1);
    expect(dash.departments).toHaveLength(1);
  });

  it("keeps the KPI strip and the rate consistent with each other", () => {
    const dash = buildDashboard({
      days: [day("present"), day("present"), day("late"), day("shift_not_started")],
    });
    const kpi = dash.kpis.find((k) => k.key === "attendance_rate");
    // 3 present of 3 eligible, because the fourth has not started.
    expect(kpi.value).toBe("100%");
    expect(kpi.hint).toBe("3 of 3 on shift");
  });

  it("reports every department an employee belongs to", () => {
    const dash = buildDashboard({
      days: [
        day("present", { department_name: "Field" }),
        day("absent", { department_name: "Warehouse" }),
      ],
    });
    expect(dash.departments.map((d) => d.name).sort()).toEqual(["Field", "Warehouse"]);
  });

  it("survives being called with nothing", () => {
    const dash = buildDashboard();
    expect(dash.kpis).toHaveLength(8);
    expect(dash.summary.total).toBe(0);
    expect(dash.rate).toEqual({ pct: 0, present: 0, denominator: 0 });
    expect(dash.risk).toEqual([]);
  });
});
describe("countsByEmployee", () => {
  it("keeps every event's signals instead of only the last", async () => {
    // Regression guard. Counting one event at a time and merging the objects
    // looks equivalent but is not: each result carries a zero for every signal
    // that event did not raise, so merging silently discards the earlier ones.
    const { countsByEmployee } = await import("@/lib/monitor/signals");

    const counts = countsByEmployee([
      { employee_id: "e1", type: "fake_gps" },
      { employee_id: "e1", type: "power_off" },
      { employee_id: "e2", type: "dead_zone" },
    ]);

    expect(counts.get("e1").fake_gps).toBe(1);
    expect(counts.get("e1").power_off).toBe(1);
    expect(counts.get("e2").dead_zone).toBe(1);
    expect(counts.get("e2").fake_gps).toBe(0);
  });

  it("returns an empty map for no events", async () => {
    const { countsByEmployee } = await import("@/lib/monitor/signals");
    expect(countsByEmployee([]).size).toBe(0);
  });

  it("skips events with no employee rather than creating a null bucket", async () => {
    const { countsByEmployee } = await import("@/lib/monitor/signals");
    expect(countsByEmployee([{ type: "power_off" }]).size).toBe(0);
  });
});
