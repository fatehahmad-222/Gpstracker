/**
 * Attendance derivation — the JS mirror of the SQL in migration 0010.
 *
 * Kept in sync deliberately: the browser needs to preview today's status
 * without a round-trip, and the unit tests assert both agree on the rules.
 *
 * The headline business rule from the spec: ABSENT excludes employees whose
 * shift has not started yet. Those are counted as `shift_not_started`.
 */

import {
  DEFAULT_TZ,
  addDays,
  toCompanyDate,
  isOvernightShift,
  shiftLengthMinutes,
  minutesSinceCompanyMidnight,
  companyTimeOnDay,
} from "./datetime";

export const STATUS_META = {
  present: { label: "Present", pill: "bg-brand-tint text-brand", chip: "P", chipClass: "bg-brand text-white" },
  absent: { label: "Absent", pill: "bg-crit-tint text-crit", chip: "A", chipClass: "bg-crit text-white" },
  late: { label: "Late", pill: "bg-high-tint text-high", chip: "L", chipClass: "bg-high text-white" },
  half_day: { label: "Half Day", pill: "bg-brand-tint text-brand-strong", chip: "H", chipClass: "bg-brand-strong text-white" },
  early_exit: { label: "Early Departure", pill: "bg-brand-tint text-brand-strong", chip: "E", chipClass: "bg-brand-strong text-white" },
  shift_not_started: { label: "Shift Not Started", pill: "bg-surface-2 text-ink-dim", chip: "—", chipClass: "bg-ink-dim text-white" },
};

export const HALF_DAY_SECONDS = 4 * 3600;

/** Countdown timer chips for the dashboard ("Starts in 2h 10m"). */
export function shiftStartsInMinutes(now, shiftStartMin, tz = DEFAULT_TZ) {
  const nowMinutes = minutesSinceCompanyMidnight(now, tz);
  return ((Number(shiftStartMin) - nowMinutes) % 1440 + 1440) % 1440;
}

/**
 * Derive one employee's day.
 *
 * @param {object} args
 * @param {object} args.employee     employees row (needs shift_start / shift_end)
 * @param {Array}  args.sessions     attendance_sessions within the day
 * @param {object} args.now          Date, for "shift not started yet"
 * @param {number} args.graceMinutes late grace period from company settings
 * @param {string} args.tz          company timezone; the rules are written in
 *                                  company-local time, matching the SQL's
 *                                  `at time zone`, so they must not read the
 *                                  runtime's zone
 */
export function deriveDay({
  employee,
  sessions = [],
  now = new Date(),
  graceMinutes = 15,
  tz = DEFAULT_TZ,
}) {
  const shiftStart = Number(employee?.shift_start ?? 540);
  const shiftEnd = Number(employee?.shift_end ?? 1020);
  const plannedSeconds = shiftLengthMinutes(shiftStart, shiftEnd) * 60;

  const ordered = [...sessions].sort(
    (a, b) => new Date(a.clock_in_at).getTime() - new Date(b.clock_in_at).getTime()
  );

  if (ordered.length === 0) {
    const nowMinutes = minutesSinceCompanyMidnight(now, tz);
    const minutesUntil = ((shiftStart - nowMinutes) % 1440 + 1440) % 1440;
    // Only "shift not started" while the shift genuinely has not begun. Once
    // the shift's own start time has passed today, silence means absent.
    const startsLaterToday = nowMinutes < shiftStart;
    if (startsLaterToday) {
        return {
          status: "shift_not_started",
          first_in: null,
          last_out: null,
          stay_seconds: 0,
          punctuality: null,
          early_exit: false,
          late_minutes: 0,
          overtime_seconds: 0,
          planned_seconds: plannedSeconds,
          starts_in_minutes: minutesUntil,
        };
      }
    return {
      status: "absent",
      first_in: null,
      last_out: null,
      stay_seconds: 0,
      punctuality: null,
      early_exit: false,
      late_minutes: 0,
      overtime_seconds: 0,
      planned_seconds: plannedSeconds,
      starts_in_minutes: null,
    };
  }

  const firstIn = new Date(ordered[0].clock_in_at);
  const lastOut = ordered.reduce((latest, s) => {
    const t = s.clock_out_at ? new Date(s.clock_out_at) : new Date(s.clock_in_at);
    return t > latest ? t : latest;
  }, firstIn);

  const staySeconds = ordered.reduce((sum, s) => {
    const from = new Date(s.clock_in_at);
    const to = s.clock_out_at ? new Date(s.clock_out_at) : lastOut;
    return sum + Math.max(0, (to - from) / 1000);
  }, 0);

  const shiftStartAt = minutesInto(firstIn, shiftStart, tz);
  const lateMinutes = Math.max(0, Math.round((firstIn - shiftStartAt) / 60000) - graceMinutes);

  const stillIn = ordered.some((s) => !s.clock_out_at);
  const status = stillIn
    ? "present"
    : staySeconds < HALF_DAY_SECONDS
      ? "half_day"
      : "present";

  const shiftEndAt = minutesInto(lastOut, shiftEnd, tz);
  const earlyExit = !stillIn && lastOut.getTime() < shiftEndAt.getTime() - 30 * 60000;
  const overtimeSeconds = Math.max(0, Math.round((lastOut - shiftEndAt) / 1000));

  return {
    status,
    first_in: firstIn.toISOString(),
    last_out: stillIn ? null : lastOut.toISOString(),
    stay_seconds: Math.round(staySeconds),
    punctuality: lateMinutes > 0 ? "late" : "on_time",
    early_exit: earlyExit,
    late_minutes: lateMinutes,
    overtime_seconds: overtimeSeconds,
    planned_seconds: plannedSeconds,
    starts_in_minutes: null,
  };
}

/**
 * The shift start instant for the day `reference` falls in.
 * For an overnight shift the 21:00 start belongs to the same calendar day it
 * began on, so a 02:00 punch counts against the previous evening's shift.
 */
function minutesInto(reference, shiftStartMin, tz) {
  let start = companyTimeOnDay(reference, shiftStartMin, tz);
  if (!start) return reference;

  // If the clock-in is more than half a day before this evening's start,
  // it belongs to the shift that began yesterday.
  if (start.getTime() - reference.getTime() > 12 * 3600000) {
    start = new Date(companyTimeOnDay(reference, shiftStartMin - 1440, tz));
  }
  return start;
}

/**
 * Roll many employees up into the counts the Dashboard's Daily Summary needs.
 * Absent deliberately excludes shift_not_started.
 */
export function summariseDay(rows = []) {
  const base = {
    total: 0,
    present: 0,
    absent: 0,
    late: 0,
    on_time: 0,
    half_day: 0,
    shift_not_started: 0,
    early_exit: 0,
    overtime: 0,
    device_offline: 0,
  };

  for (const row of rows) {
    base.total += 1;
    switch (row.status) {
      case "present":
        base.present += 1;
        if (row.punctuality === "late") base.late += 1;
        else base.on_time += 1;
        break;
      case "late":
        base.present += 1;
        base.late += 1;
        break;
      case "half_day":
        base.half_day += 1;
        break;
      case "shift_not_started":
        base.shift_not_started += 1;
        break;
      case "absent":
      default:
        base.absent += 1;
        break;
    }
    if (row.early_exit) base.early_exit += 1;
    if (Number(row.overtime_seconds) > 0) base.overtime += 1;
    if (row.device_offline) base.device_offline += 1;
  }

  // Present minus late is the spec's "On Time Arrival".
  base.on_time_arrival = Math.max(0, base.present - base.late);
  base.on_time_exit = Math.max(0, base.present - base.early_exit);
  return base;
}

/** Attendance percentage per department row for the dashboard card. */
export function departmentAttendance(rows = []) {
  const byDept = new Map();

  for (const row of rows) {
    const key = row.department_name || "Unassigned";
    const entry = byDept.get(key) || { name: key, present: 0, total: 0 };
    entry.total += 1;
    if (["present", "late", "half_day"].includes(row.status)) entry.present += 1;
    byDept.set(key, entry);
  }

  return [...byDept.values()]
    .map((d) => ({
      ...d,
      pct: d.total ? Math.round((d.present / d.total) * 100) : 0,
    }))
    .sort((a, b) => a.pct - b.pct);
}

/** 7-day window ending on `endDate`, oldest first — the dashboard trend. */
export function weeklyTrend(rows = [], endDate = new Date(), tz = DEFAULT_TZ) {
  const end = toCompanyDate(endDate, tz);
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const iso = addDays(end, -i);
    const dayRows = rows.filter((r) => String(r.date).slice(0, 10) === iso);
    const s = summariseDay(dayRows);
    days.push({
      date: iso,
      present: s.present,
      absent: s.absent,
      late: s.late,
      pct: s.total ? Math.round((s.present / s.total) * 100) : 0,
    });
  }
  return days;
}

/** The Attendance filter chips: All / Present / Absent / Late / On Time. */
export function attendanceChips(rows = []) {
  const s = summariseDay(rows);
  return [
    { key: "all", label: "All", count: s.total },
    { key: "present", label: "Present", count: s.present },
    { key: "absent", label: "Absent", count: s.absent },
    { key: "late", label: "Late", count: s.late },
    { key: "on_time", label: "On Time", count: s.on_time },
  ];
}

/**
 * Does a derived row belong in the current filter?
 *
 * `status` is computed rather than stored, so this cannot live in SQL. It sits
 * with the other pure rules rather than in the server layer so the client can
 * filter optimistically and the tests do not need a Supabase client.
 */
export function matchesStatusFilter(row, status) {
  if (!status || status === "all") return true;
  // "Present" means attendance, not punctuality: somebody forty minutes late is
  // still on site, and hiding them would make the header counts lie.
  if (status === "present") return row.status === "present" || row.status === "late";
  if (status === "late") return row.punctuality === "late";
  if (status === "on_time") return row.punctuality === "on_time";
  return row.status === status;
}

export { isOvernightShift };