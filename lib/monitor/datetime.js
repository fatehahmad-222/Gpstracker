/**
 * Company-timezone date/time helpers for the monitor module.
 *
 * Built on `Intl` only — the project has no date library and adding one for
 * four formatters would be wasteful. Everything is stored UTC and rendered in
 * the company's timezone (default Asia/Karachi).
 */

export const DEFAULT_TZ = "Asia/Karachi";

const cache = new Map();

function fmt(timeZone, options) {
  const key = `${timeZone}|${JSON.stringify(options)}`;
  if (!cache.has(key)) {
    cache.set(key, new Intl.DateTimeFormat("en-GB", { timeZone, ...options }));
  }
  return cache.get(key);
}

export const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** yyyy-mm-dd in the company's timezone. */
export function toCompanyDate(value, tz = DEFAULT_TZ) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  // Assemble from parts rather than using .format(): "en-GB" renders a bare
  // numeric date as dd/mm/yyyy, and every caller here assumes yyyy-mm-dd.
  const parts = fmt(tz, { year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
  const get = (t) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** "25 September 2026" — the reference product's long form. */
export function formatLongDate(value, tz = DEFAULT_TZ) {
  const d = value instanceof Date ? value : new Date(value);
  if (!d || Number.isNaN(d.getTime())) return "—";
  const parts = fmt(tz, { year: "numeric", month: "long", day: "numeric" }).formatToParts(d);
  const get = (t) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("day")} ${get("month")} ${get("year")}`;
}

/** "09/25/2026" — mm/dd/yyyy, used by the attendance date navigator. */
export function formatUsDate(value, tz = DEFAULT_TZ) {
  const iso = toCompanyDate(value, tz);
  if (!iso) return "—";
  return `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(0, 4)}`;
}

/** "SEP-2026" — the policy month-year picker value. */
export function formatMonthYear(value, tz = DEFAULT_TZ) {
  const iso = toCompanyDate(value, tz);
  if (!iso) return "—";
  const month = MONTHS[Number(iso.slice(5, 7)) - 1].slice(0, 3).toUpperCase();
  return `${month}-${iso.slice(0, 4)}`;
}

/** "19 Sep (Sat)" — the 7-day history table's date column. */
export function formatDayWithWeekday(value, tz = DEFAULT_TZ) {
  const d = value instanceof Date ? value : new Date(value);
  if (!d || Number.isNaN(d.getTime())) return "—";
  const iso = toCompanyDate(d, tz);
  const month = MONTHS[Number(iso.slice(5, 7)) - 1].slice(0, 3);
  const weekday = WEEKDAYS[new Date(`${iso}T00:00:00Z`).getUTCDay()];
  return `${Number(iso.slice(8, 10))} ${month} (${weekday})`;
}

/** Clock time in the company timezone. */
export function formatClockTime(value, tz = DEFAULT_TZ) {
  if (!value) return "—";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  // en-GB emits a lowercase meridiem; minutesToLabel uses uppercase, and the
  // two appear in the same tables, so normalise here.
  return fmt(tz, { hour: "2-digit", minute: "2-digit", hour12: true })
    .format(d)
    .replace(/\s*(am|pm)$/i, (_, m) => ` ${m.toUpperCase()}`);
}

/** "23:27:33" — 24h, used for event timestamps and durations. */
export function formatHms(value, tz = DEFAULT_TZ) {
  if (!value) return "—";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return fmt(tz, {
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).format(d);
}

/** "2h 14m 6s" / "34m 17s" — the tracker stat tiles. */
export function formatDuration(seconds) {
  if (seconds == null || Number.isNaN(Number(seconds))) return "—";
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

/** Compact human age: "4 h", "22 m", "never". */
export function formatAge(fromIso, now = Date.now()) {
  if (!fromIso) return "never";
  const t = new Date(fromIso).getTime();
  if (Number.isNaN(t)) return "never";
  const mins = Math.max(0, Math.floor((now - t) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} m`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours} h`;
  return `${Math.floor(hours / 24)} d`;
}

// ---------------------------------------------------------------------------
// Shift times are stored as minutes-from-midnight (see migration 0004) so
// overnight shifts such as 21:00 -> 06:00 need no special casing.
// ---------------------------------------------------------------------------

export function minutesToLabel(mins) {
  if (mins == null) return "—";
  const m = ((Number(mins) % 1440) + 1440) % 1440;
  const h24 = Math.floor(m / 60);
  const mm = String(m % 60).padStart(2, "0");
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${String(h12).padStart(2, "0")}:${mm} ${h24 < 12 ? "AM" : "PM"}`;
}

export function labelToMinutes(hour, minute, meridiem) {
  let h = Number(hour) % 12;
  if (meridiem === "PM") h += 12;
  return (h * 60 + Number(minute)) % 1440;
}

export function shiftRangeLabel(startMin, endMin) {
  return `${minutesToLabel(startMin)} - ${minutesToLabel(endMin)}`;
}

export function isOvernightShift(startMin, endMin) {
  return Number(endMin) <= Number(startMin);
}

/** Shift length in minutes, handling overnight shifts. */
export function shiftLengthMinutes(startMin, endMin) {
  const s = Number(startMin);
  const e = Number(endMin);
  return e > s ? e - s : 1440 - s + e;
}

// ---------------------------------------------------------------------------
// Range helpers
// ---------------------------------------------------------------------------

/** UTC instants covering one company-local calendar day. */
export function companyDayRange(dateStr, tz = DEFAULT_TZ) {
  const [y, m, d] = String(dateStr).slice(0, 10).split("-").map(Number);
  const startUtc = Date.UTC(y, m - 1, d);
  // Derive the offset at that instant, then step back to local midnight.
  const probe = new Date(startUtc);
  const offset = tzOffsetMinutes(probe, tz);
  const from = new Date(startUtc - offset * 60000);
  const nextProbe = new Date(startUtc + 86400000);
  const nextOffset = tzOffsetMinutes(nextProbe, tz);
  const to = new Date(startUtc + 86400000 - nextOffset * 60000);
  return { from: from.toISOString(), to: to.toISOString() };
}

function tzOffsetMinutes(date, tz) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const parts = dtf.formatToParts(date);
  const get = (t) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const asUtc = Date.UTC(
    get("year"), get("month") - 1, get("day"),
    get("hour") % 24, get("minute"), get("second")
  );
  return (asUtc - date.getTime()) / 60000;
}

/** "Today, 25 September 2026" — the Command Center subtitle. */
export function formatTodayLabel(tz = DEFAULT_TZ) {
  return `Today, ${formatLongDate(new Date(), tz)}`;
}

export function addDays(dateStr, days) {
  const d = new Date(`${String(dateStr).slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(fromStr, toStr) {
  const a = Date.parse(`${String(fromStr).slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${String(toStr).slice(0, 10)}T00:00:00Z`);
  return Math.round((b - a) / 86400000);
}