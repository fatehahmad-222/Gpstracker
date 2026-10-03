/**
 * SIGNAL DEFINITIONS — single source of truth.
 *
 * The Dashboard's eight "Device & Data Alerts" tiles and the Command Center's
 * signal chips both read from this list, so a tile can never drift from the
 * table column it links to. Column visibility, CSV export and the event
 * drill-down all derive their keys from `key` too.
 *
 * `derived: true` signals are computed server-side from device_profiles /
 * attendance_sessions rather than being counted straight out of device_events.
 */

// "low" must be present: several signals use it, and highestSeverity() drops
// any severity missing from this map.
export const SEVERITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };

export const SEVERITY_META = {
  critical: {
    label: "Critical",
    pill: "bg-crit-tint text-crit",
    dot: "bg-crit",
    tile: "border-l-crit",
    chip: "border-crit/40 bg-crit-tint text-crit",
  },
  high: {
    label: "High",
    pill: "bg-high-tint text-high",
    dot: "bg-high",
    tile: "border-l-high",
    chip: "border-high/40 bg-high-tint text-high",
  },
  medium: {
    label: "Medium",
    pill: "bg-med-tint text-med",
    dot: "bg-med",
    tile: "border-l-med",
    chip: "border-med/40 bg-med-tint text-med",
  },
  low: {
    label: "Low",
    pill: "bg-surface-2 text-ink-dim",
    dot: "bg-ink-dim",
    tile: "border-l-ink-dim",
    chip: "border-line bg-surface-2 text-ink-dim",
  },
};

/**
 * `eventTypes` are the device_events.type values counted for this signal.
 * `derived` signals have no event types and are computed by deriveSignals().
 */
export const SIGNALS = [
  // --- the eight dashboard alert tiles, in spec order ---
  {
    key: "data_cleared",
    label: "Data cleared / reinstalled",
    eventTypes: ["data_cleared"],
    severity: "critical",
    category: "Data Loss",
    tileHint: "Unsynced records on the phone are gone",
    column: "Data cleared",
    pending: false,
  },
  {
    key: "logged_in_not_synced",
    label: "Logged in, not synced since",
    eventTypes: ["logged_in_not_synced"],
    severity: "critical",
    category: "Data Loss",
    tileHint: "Work done after the last sync never reached the server",
    column: "Logged in, not synced",
    pending: false,
  },
  {
    key: "no_sync_24h",
    label: "No sync for 24 hours+",
    eventTypes: [],
    severity: "high",
    category: "Data Pending",
    tileHint: "Records are stuck on the phone",
    column: "No sync 24h+",
    derived: "no_sync_24h",
    pending: false,
  },
  {
    key: "unsupported",
    label: "Unsupported device",
    eventTypes: [],
    severity: "high",
    category: "Accuracy Problems",
    tileHint: "Android below the minimum — GPS and background tracking unreliable",
    column: "Unsupported",
    derived: "unsupported",
    pending: false,
  },
  {
    key: "second_device",
    label: "Signed in from a different device",
    eventTypes: ["second_device"],
    severity: "high",
    category: "Possible Fraud",
    tileHint: "Login moved to another phone in the last 24 hours",
    column: "2nd device",
    pending: false,
  },
  {
    key: "location_off",
    label: "Location turned off",
    eventTypes: ["location_off"],
    severity: "high",
    category: "Tracking Lost",
    tileHint: "System clocked the employee out because GPS was off",
    column: "Location off",
    pending: false,
  },
  {
    key: "force_stop",
    label: "App force-stopped / killed",
    eventTypes: ["force_stop"],
    severity: "high",
    category: "Tracking Lost",
    tileHint: "Tracking stays off until the app is reopened",
    column: "Force stop",
    pending: false,
  },
  {
    key: "auto_time_off",
    label: "Automatic time turned off",
    eventTypes: ["auto_time_off"],
    severity: "high",
    category: "Time Tampering",
    tileHint: "Phone clock can be changed to fake punch times",
    column: "Auto time off",
    pending: false,
  },

  // --- remaining Command Center columns ---
  { key: "time_diff", label: "Time difference", eventTypes: ["time_diff"], severity: "medium", category: "Time Tampering", column: "Time diff", pending: false },
  { key: "power_off", label: "Power off", eventTypes: ["power_off"], severity: "medium", category: "Tracking Lost", column: "Power off", pending: false },
  { key: "battery_restrict", label: "Battery restricted", eventTypes: ["battery_restrict"], severity: "medium", category: "Tracking Lost", column: "Battery restrict", pending: false },
  { key: "dead_zone", label: "Dead zone", eventTypes: ["dead_zone"], severity: "medium", category: "Tracking Lost", column: "Dead zone", pending: false },
  { key: "developer_mode", label: "Developer mode", eventTypes: ["developer_mode"], severity: "high", category: "Possible Fraud", column: "Developer mode", pending: false },
  { key: "fake_gps", label: "Fake GPS", eventTypes: ["fake_gps"], severity: "critical", category: "Possible Fraud", column: "Fake GPS", pending: false },
  { key: "out_of_zone", label: "Out of zone", eventTypes: ["out_of_zone"], severity: "high", category: "Accuracy Problems", column: "Out of zone", pending: false },
  { key: "heartbeat_gap", label: "Heartbeat gaps", eventTypes: ["heartbeat_gap"], severity: "medium", category: "Tracking Lost", column: "Heartbeat gaps", pending: false },
  { key: "impossible_travel", label: "Impossible travel", eventTypes: ["impossible_travel"], severity: "critical", category: "Possible Fraud", column: "Impossible travel", pending: false },
  { key: "logged_out", label: "Logged out", eventTypes: ["logged_out"], severity: "medium", category: "Tracking Lost", column: "Logged out", pending: false },
  { key: "admin_logout", label: "Admin logout", eventTypes: ["admin_logout"], severity: "low", category: "Other", column: "Admin logout", pending: false },
  { key: "sim_change", label: "SIM change", eventTypes: ["sim_change"], severity: "high", category: "Possible Fraud", column: "SIM change", pending: false },
  { key: "old_app", label: "Old app version", eventTypes: ["old_app"], severity: "low", category: "Other", column: "Old app", pending: false },

  // --- hidden by default: the mobile app does not report these yet ---
  { key: "battery_low", label: "Battery low", eventTypes: ["battery_low"], severity: "low", category: "Other", column: "Battery low", pending: true },
  { key: "dead_zone_pending", label: "Dead zone (detailed)", eventTypes: [], severity: "low", category: "Tracking Lost", column: "Dead zone (detail)", pending: true },
  { key: "heartbeat_detail", label: "Heartbeat detail", eventTypes: [], severity: "low", category: "Tracking Lost", column: "Heartbeat (detail)", pending: true },
];

export const SIGNAL_BY_KEY = Object.fromEntries(SIGNALS.map((s) => [s.key, s]));

export const SIGNAL_KEYS = SIGNALS.map((s) => s.key);

/** Columns the Command Center shows by default. */
export const DEFAULT_VISIBLE_COLUMNS = SIGNAL_KEYS.filter(
  (k) => !SIGNAL_BY_KEY[k].pending
);

export const PENDING_COLUMNS = SIGNAL_KEYS.filter((k) => SIGNAL_BY_KEY[k].pending);

/** Reverse index: event type -> the signals it contributes to. */
export const EVENT_TYPE_TO_SIGNAL = SIGNALS.reduce((acc, s) => {
  for (const t of s.eventTypes || []) {
    (acc[t] ||= []).push(s.key);
  }
  return acc;
}, {});

/**
 * Convert raw device_events rows into per-employee signal counts.
 * One event can raise more than one signal, hence the fan-out.
 */
export function countsFromEvents(events = []) {
  const counts = Object.fromEntries(SIGNAL_KEYS.map((k) => [k, 0]));

  for (const ev of events) {
    for (const key of EVENT_TYPE_TO_SIGNAL[ev.type] || []) {
      counts[key] = (counts[key] || 0) + 1;
    }
  }
  return counts;
}

/**
 * Derived signals that are scored but have no Command Center column.
 *
 * `no_clock_in` has no `device_events.type` to count and no column to show, but
 * `DEFAULT_RISK_WEIGHTS` gives it a weight, so it still has to survive the merge
 * below. Without this list it would be silently dropped and every risk score
 * would understate absence.
 */
export const SCORED_DERIVED_KEYS = ["no_clock_in"];

/**
 * Merge the counted signals with the derived ones.
 * `derived` is keyed by signal key and holds a number.
 */
export function mergeSignalCounts(counts, derived = {}) {
  const merged = { ...counts };
  for (const [key, value] of Object.entries(derived)) {
    // Accept a column-backed signal or an explicitly scoreable derived one, and
    // ignore anything else so a typo cannot invent a score.
    const known = key in merged || SCORED_DERIVED_KEYS.includes(key);
    if (!known) continue;
    if (value == null) continue;
    merged[key] = typeof value === "boolean" ? (value ? 1 : 0) : Number(value) || 0;
  }
  return merged;
}

export function activeSignalKeys(counts = {}) {
  return SIGNAL_KEYS.filter((k) => (counts[k] || 0) > 0);
}

export function highestSeverity(counts = {}) {
  const active = SIGNALS.filter((s) => (counts[s.key] || 0) > 0 && SEVERITY_ORDER[s.severity] != null);
  if (active.length === 0) return null;
  return active.sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]
  )[0].severity;
}

/** Column ordering for the Command Center, matching spec 4.2 exactly. */
export const COMMAND_CENTER_COLUMNS = [
  "Employee",
  "Department",
  "Designation",
  "Clock in",
  "Clock out",
  "Last login",
  "Logins",
  "Last sync",
  "Sync age",
  "Data cleared",
  "2nd device",
  "Unsupported",
  "Auto time off",
  "Time diff",
  "Location off",
  "Power off",
  "Force stop",
  "Battery restrict",
  "Dead zone",
  "Developer mode",
  "Fake GPS",
  "Out of zone",
  "Heartbeat gaps",
  "Impossible travel",
  "Logged out",
  "Admin logout",
  "SIM change",
  "Old app",
  "Risk",
];