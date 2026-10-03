/**
 * Alert and violation rules.
 *
 * `device_events` is the raw evidence: twenty event types, several of which are
 * noise (a battery warning is not an accusation). `violations` is the work queue
 * a manager actually triages — opened, acknowledged, resolved.
 *
 * This module is the pure part of turning one into the other. Kept away from
 * Supabase so the policy can be tested: specifically, when a repeated signal
 * should and should not become a second open violation.
 */

import { SIGNALS, SIGNAL_BY_KEY, SEVERITY_ORDER, EVENT_TYPE_TO_SIGNAL } from "./signals";
import { DEFAULT_RISK_WEIGHTS, computeRisk } from "./risk";

/**
 * Signal category → the `violations.category` vocabulary.
 *
 * Deliberately broader than the eight dashboard tiles: the medium and low
 * signals still need somewhere to file, and "Other" is an honest answer for the
 * handful that genuinely have no better home.
 *
 * "Attendance" is here because the scheduled jobs in 0010 raise violations
 * directly (`no_checkout`, `idle_no_movement`, `presence_check_missed`) rather
 * than through a device event. Those land in the same queue and would otherwise
 * be invisible to the category filter.
 */
export const VIOLATION_CATEGORIES = [
  "Data Loss",
  "Data Pending",
  "Accuracy Problems",
  "Possible Fraud",
  "Tracking Lost",
  "Time Tampering",
  "Attendance",
  "Other",
];

export const DEFAULT_CATEGORY = "Other";

/** Category for a signal key, falling back to "Other". */
export function categoryForSignal(key) {
  return SIGNAL_BY_KEY[key]?.category || DEFAULT_CATEGORY;
}

/**
 * Violations raised server-side rather than from a device event.
 *
 * These are not in `SIGNAL_BY_KEY` and must not be: that catalogue drives
 * `countsFromEvents`, and these types never appear in `device_events`. Adding
 * them there would make the signal tiles count rows that cannot exist.
 *
 * Kept separate so the queue can still label and file them, instead of showing a
 * manager `no_checkout` in snake_case.
 */
export const RAISED_VIOLATION_TYPES = {
  no_checkout: { label: "No check-out", category: "Attendance" },
  idle_no_movement: { label: "No movement", category: "Attendance" },
  presence_check_missed: { label: "Check-in not confirmed", category: "Attendance" },
  no_clock_in: { label: "No clock-in", category: "Attendance" },
};

/** Human label for any violation type, device-derived or server-raised. */
export function violationLabel(type) {
  return RAISED_VIOLATION_TYPES[type]?.label || SIGNAL_BY_KEY[type]?.label || type;
}

/** Category for any violation type. */
export function violationCategory(type) {
  return RAISED_VIOLATION_TYPES[type]?.category || categoryForSignal(type);
}

/**
 * Statuses a violation moves through, in order.
 *
 * `resolved` is deliberately not reachable from `open` in one step: a manager
 * has to acknowledge before closing, so "who ignored this" stays answerable.
 */
export const VIOLATION_STATUSES = ["open", "acknowledged", "resolved"];

/** Is this transition legal? Anything not listed is rejected. */
export function canTransition(from, to) {
  if (from === to) return true;
  if (from === "open") return to === "acknowledged";
  if (from === "acknowledged") return to === "resolved" || to === "open";
  return false;
}

/**
 * Should this event open a violation at all?
 *
 * Low-severity signals are informational — a battery warning does not belong in
 * a manager's queue. `derived` signals never arrive as events, so a device that
 * is merely *unsupported* is surfaced on the Command Center rather than filed as
 * an accusation against one employee.
 */
export function shouldRaiseViolation(event) {
  if (!event?.type) return false;
  const signalKeys = EVENT_TYPE_TO_SIGNAL[event.type] || [];
  if (!signalKeys.length) return false;

  // SEVERITY_ORDER is ascending in seriousness (critical = 0), so "medium or
  // worse" is a <= against medium. Comparing against high here would silently
  // drop every medium signal.
  return signalKeys.some((key) => {
    const signal = SIGNAL_BY_KEY[key];
    return signal && SEVERITY_ORDER[signal.severity] <= SEVERITY_ORDER.medium;
  });
}

/**
 * The identity of a violation: one open item per employee per signal type.
 *
 * Used to collapse a phone that reports the same fault every thirty seconds into
 * a single row instead of flooding the queue.
 */
export function violationKey(employeeId, eventType) {
  return `${employeeId}:${eventType}`;
}

/**
 * Build the violations implied by a window of events, skipping anything already
 * open.
 *
 * @param {object}   args
 * @param {Array}    args.events     device_events rows
 * @param {Array}    args.open       currently open/acknowledged violations
 * @param {string}   args.companyId
 * @returns {{ rows: Array, skipped: number, summary: object }}
 */
export function violationsFromEvents({ events = [], open = [], companyId } = {}) {
  const alreadyOpen = new Set(
    open
      .filter((v) => v.status !== "resolved")
      .map((v) => violationKey(v.employee_id, v.type))
  );

  const seen = new Set();
  const rows = [];

  // Sorted so a burst that arrives out of order still files the first
  // occurrence, which is the moment the manager needs to see.
  const ordered = [...events].sort(
    (a, b) => new Date(a.occurred_at || 0) - new Date(b.occurred_at || 0)
  );

  for (const event of ordered) {
    if (!shouldRaiseViolation(event)) continue;

    const key = violationKey(event.employee_id, event.type);

    // Already raised and not yet resolved: bump its count instead of filing a
    // duplicate, which is what makes the list readable.
    if (alreadyOpen.has(key) || seen.has(key)) continue;
    seen.add(key);

    rows.push({
      company_id: companyId,
      employee_id: event.employee_id,
      type: event.type,
      category: categoryForSignal(event.type),
      severity: SIGNAL_BY_KEY[EVENT_TYPE_TO_SIGNAL[event.type][0]]?.severity || "high",
      occurred_at: event.occurred_at,
      status: "open",
      meta: { event_id: event.id, reported_at: event.reported_at ?? null },
    });
  }

  return { rows, skipped: events.length - rows.length, summary: summariseViolations(rows) };
}

/**
 * Headline counts for the alerts header.
 *
 * Open and acknowledged are reported together as "needs attention", because a
 * violation somebody has looked at but not finished is still on the list.
 */
export function summariseViolations(violations = []) {
  const base = {
    total: violations.length,
    open: 0,
    acknowledged: 0,
    resolved: 0,
    unresolved: 0,
    critical: 0,
    high: 0,
    medium: 0,
    by_category: {},
  };

  for (const v of violations) {
    base[v.status] = (base[v.status] || 0) + 1;
    if (v.status !== "resolved") base.unresolved += 1;
    if (base[v.severity] !== undefined) base[v.severity] += 1;

    const category = v.category || DEFAULT_CATEGORY;
    base.by_category[category] = (base.by_category[category] || 0) + 1;
  }

  return base;
}

/** Categories ordered by how many unresolved violations each holds. */
export function categoryBreakdown(violations = [], categories = VIOLATION_CATEGORIES) {
  const counts = Object.fromEntries(categories.map((c) => [c, { category: c, total: 0, unresolved: 0 }]));

  for (const v of violations) {
    const category = v.category || DEFAULT_CATEGORY;
    if (!counts[category]) counts[category] = { category, total: 0, unresolved: 0 };
    counts[category].total += 1;
    if (v.status !== "resolved") counts[category].unresolved += 1;
  }

  return Object.values(counts)
    .filter((c) => c.total > 0)
    .sort((a, b) => b.unresolved - a.unresolved || b.total - a.total);
}

/**
 * The severity tiles: the spec's eight dashboard alert tiles.
 *
 * Every signal now carries a `category` (a critical fake-GPS report has to file
 * somewhere meaningful), so category alone can no longer identify a tile. The
 * tiles are the signals that ship a `tileHint`, which is exactly the eight the
 * dashboard shows.
 */
export function alertTiles(counts = {}) {
  return SIGNALS.filter((s) => s.tileHint)
    .map((signal) => ({
      key: signal.key,
      label: signal.label,
      hint: signal.tileHint,
      severity: signal.severity,
      category: signal.category,
      count: counts[signal.key] || 0,
    }))
    .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || b.count - a.count);
}

/**
 * Top-risk employees from per-employee signal counts.
 *
 * Delegates the arithmetic to `computeRisk` rather than repeating the weighted
 * sum here, so there is exactly one place that defines what a score means.
 */
export function riskiest(countsByEmployee = [], { limit = 5, weights = DEFAULT_RISK_WEIGHTS } = {}) {
  return Object.entries(countsByEmployee || {})
    .map(([employeeId, counts]) => ({
      employee_id: employeeId,
      ...computeRisk(counts, weights),
    }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}