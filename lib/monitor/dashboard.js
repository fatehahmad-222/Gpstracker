/**
 * Dashboard derivation (spec 4.1).
 *
 * The card set is derived here rather than assembled in the component, so the
 * arithmetic that a manager ends up arguing about — who counts as present, what
 * the attendance percentage is measured against, which violations are "open" —
 * is testable without a browser or a database.
 *
 * Two rules run through the whole module:
 *
 *   1. Counts are pinned to the whole company. The dashboard has no row
 *      filters, so a number that changed when something else on the page
 *      changed would be unreadable.
 *   2. Where a percentage has a denominator worth arguing about, the
 *      denominator is reported next to it. "94% attendance" means nothing
 *      until you know it is out of everyone whose shift had started.
 */

import { summariseDay, departmentAttendance } from "./attendance";
import { summariseViolations, categoryBreakdown, alertTiles, violationLabel } from "./alerts";
import { countsFromEvents, countsByEmployee, mergeSignalCounts, SIGNAL_BY_KEY } from "./signals";
import { resolveWeights, computeRisk, riskBand } from "./risk";

/**
 * Employees whose shift has not started yet are neither present nor absent.
 *
 * Counting them as absent would make an early-morning dashboard look like a
 * crisis, and counting them as present would inflate attendance. They are
 * excluded from the attendance rate entirely and surfaced as their own figure.
 */
export function attendanceRate(summary = {}) {
  const denominator = (summary.total || 0) - (summary.shift_not_started || 0);
  if (denominator <= 0) return { pct: 0, present: 0, denominator: 0 };
  const present = summary.present || 0;
  return {
    pct: Math.round((present / denominator) * 100),
    present,
    denominator,
  };
}

/**
 * The KPI strip.
 *
 * Ordered by how often it is read, not alphabetically: headcount, then today's
 * attendance, then the things that need a decision.
 */
export function headlineKpis({ summary = {}, violations = [], leaves = [], devices = [], openSessions = [] } = {}) {
  const rate = attendanceRate(summary);
  const pendingLeaves = leaves.filter((l) => l.status === "pending").length;
  const unresolved = violations.filter((v) => v.status !== "resolved").length;
  const offlineDevices = devices.filter((d) => d.status && d.status !== "online").length;

  return [
    {
      key: "headcount",
      label: "Total employees",
      value: summary.total || 0,
      accent: "brand",
      hint: `${(summary.total || 0) - (summary.shift_not_started || 0)} on shift today`,
    },
    {
      key: "present",
      label: "Present now",
      value: summary.present || 0,
      accent: "green",
      hint: `${openSessions.length} still clocked in`,
    },
    {
      key: "attendance_rate",
      label: "Attendance",
      value: `${rate.pct}%`,
      accent: rate.pct >= 90 ? "green" : rate.pct >= 75 ? "amber" : "red",
      hint: `${rate.present} of ${rate.denominator} on shift`,
    },
    {
      key: "absent",
      label: "Absent",
      value: summary.absent || 0,
      accent: summary.absent ? "red" : "slate",
      hint: `${summary.shift_not_started || 0} not started yet`,
    },
    {
      key: "late",
      label: "Late",
      value: summary.late || 0,
      accent: summary.late ? "amber" : "slate",
      hint: `${summary.on_time || 0} arrived on time`,
    },
    {
      key: "violations",
      label: "Open violations",
      value: unresolved,
      accent: unresolved ? "red" : "slate",
      hint: `${violations.length - unresolved} resolved`,
    },
    {
      key: "devices",
      label: "Devices offline",
      value: offlineDevices,
      accent: offlineDevices ? "amber" : "slate",
      hint: `${devices.length} registered`,
    },
    {
      key: "leaves",
      label: "Leaves pending",
      value: pendingLeaves,
      accent: pendingLeaves ? "blue" : "slate",
      hint: `${leaves.length} total requests`,
    },
  ];
}

/**
 * The Command Center grouping: unresolved violations by severity.
 *
 * This is the "everything happening right now" view, so it is deliberately
 * narrow — only open and acknowledged work, and never low severity, because a
 * list that leads with noise is a list nobody reads.
 */
export function commandCenterGroups(violations = [], limit = 6) {
  const unresolved = violations.filter((v) => v.status !== "resolved" && v.severity !== "low");

  const groups = [
    { key: "critical", severity: "critical", label: "Critical", rows: [] },
    { key: "high", severity: "high", label: "High", rows: [] },
    { key: "medium", severity: "medium", label: "Needs review", rows: [] },
  ];

  for (const violation of unresolved) {
    const group = groups.find((g) => g.severity === violation.severity) || groups[2];
    group.rows.push({
      ...violation,
      // Labelled here rather than in the component: the same row is rendered by
      // the dashboard, the command center and any future export, and a raw
      // snake_case type leaking into one of them would be the tell.
      label: violation.label || violationLabel(violation.type),
    });
  }

  // Worst first, then newest: within one severity a manager wants the most
  // recent thing that happened, not the alphabetically first.
  for (const group of groups) {
    group.rows.sort((a, b) => new Date(b.occurred_at) - new Date(a.occurred_at));
    group.count = group.rows.length;
    group.rows = group.rows.slice(0, limit);
  }

  return groups;
}

/**
 * Weighted risk per employee over the window.
 *
 * Events are grouped per employee and counted in one pass, then scored once by
 * `computeRisk` — which is a weighted sum over counts, so twenty force-stops
 * from one phone really do score as twenty.
 */
export function riskBoard({ events = [], people = new Map(), settings = {}, limit = 8 } = {}) {
  const weights = resolveWeights(settings);

  return [...countsByEmployee(events).entries()]
    .map(([employeeId, counts]) => {
      const merged = mergeSignalCounts(counts);
      const { score, contributions } = computeRisk(merged, weights);
      if (score <= 0) return null;

      const person = people.get(employeeId);
      const band = riskBand(score);
      return {
        employee_id: employeeId,
        emp_code: person?.emp_code || null,
        name: person?.name || "Unknown employee",
        department_name: person?.department_name || null,
        score,
        // Only the fields the UI renders. The full band carries `max`, whose
        // top value is Infinity — which JSON turns into null.
        band: { key: band.key, label: band.label, className: band.className },
        // The top three reasons, so a manager can see *why* someone is here
        // without opening them.
        reasons: contributions.slice(0, 3).map((c) => ({
          key: c.key,
          label: SIGNAL_BY_KEY[c.key]?.label || c.key,
          count: c.count,
          weight: c.weight,
        })),
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, limit);
}

/**
 * Aggregate the whole dashboard.
 *
 * Takes rows already fetched and scoped by the server layer, and returns the
 * card set. Kept as one function so the API and any future export agree on
 * what the Dashboard is made of.
 */
export function buildDashboard({
  days = [],
  violations = [],
  events = [],
  leaves = [],
  devices = [],
  openSessions = [],
  people = new Map(),
  settings = {},
  date,
  now = new Date(),
} = {}) {
  const summary = summariseDay(days);
  const rate = attendanceRate(summary);

  return {
    date,
    generated_at: now.toISOString(),
    summary,
    rate,
    kpis: headlineKpis({ summary, violations, leaves, devices, openSessions }),
    tiles: alertTiles(countsFromEvents(events)),
    command_center: commandCenterGroups(violations),
    violations: {
      total: violations.length,
      ...summariseViolations(violations),
      categories: categoryBreakdown(violations),
    },
    departments: departmentAttendance(days),
    risk: riskBoard({ events, people, settings }),
    open_sessions: openSessions,
  };
}