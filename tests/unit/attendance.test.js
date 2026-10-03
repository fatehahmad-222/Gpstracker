import { describe, it, expect } from "vitest";

import {
  deriveDay,
  summariseDay,
  departmentAttendance,
  weeklyTrend,
  attendanceChips,
  shiftStartsInMinutes,
  matchesStatusFilter,
  HALF_DAY_SECONDS,
} from "@/lib/monitor/attendance";
import { companyTimeOnDay, minutesSinceCompanyMidnight } from "@/lib/monitor/datetime";

/**
 * Asia/Karachi is UTC+5 with no DST, which makes the expected instants easy to
 * state exactly: 09:00 local is 04:00Z.
 */
const TZ = "Asia/Karachi";
/** 09:00–17:00 local. */
const DAY = { shift_start: 540, shift_end: 1020 };

/** A UTC instant for a Karachi wall-clock time. */
const at = (hhmm, day = "2026-09-25") => {
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(companyTimeOnDay(`${day}T12:00:00Z`, h * 60 + m, TZ)).toISOString();
};

describe("deriveDay — no sessions", () => {
  it("calls an unstarted shift 'shift not started', not absent", () => {
    // 06:00 local, shift starts 09:00.
    const result = deriveDay({ employee: DAY, sessions: [], now: at("06:00"), tz: TZ });
    expect(result.status).toBe("shift_not_started");
    expect(result.starts_in_minutes).toBe(180);
  });

  it("calls silence after the shift has begun 'absent'", () => {
    const result = deriveDay({ employee: DAY, sessions: [], now: at("11:00"), tz: TZ });
    expect(result.status).toBe("absent");
    expect(result.starts_in_minutes).toBeNull();
  });

  it("treats the exact shift start as absent rather than not-yet-started", () => {
    const result = deriveDay({ employee: DAY, sessions: [], now: at("09:00"), tz: TZ });
    expect(result.status).toBe("absent");
  });
});

describe("deriveDay — lateness", () => {
  it("reports on time inside the grace window", () => {
    const result = deriveDay({
      employee: DAY,
      sessions: [{ clock_in_at: at("09:10"), clock_out_at: at("17:00") }],
      now: at("18:00"),
      tz: TZ,
    });
    expect(result.punctuality).toBe("on_time");
    expect(result.late_minutes).toBe(0);
    expect(result.status).toBe("present");
  });

  it("charges only the minutes beyond the grace period", () => {
    // 09:40 is 40 minutes late, 15 of which are grace.
    const result = deriveDay({
      employee: DAY,
      sessions: [{ clock_in_at: at("09:40"), clock_out_at: at("17:00") }],
      now: at("18:00"),
      graceMinutes: 15,
      tz: TZ,
    });
    expect(result.late_minutes).toBe(25);
    expect(result.punctuality).toBe("late");
  });

  it("uses the first clock-in of the day, not the earliest session found", () => {
    const result = deriveDay({
      employee: DAY,
      // Deliberately out of order.
      sessions: [
        { clock_in_at: at("13:00"), clock_out_at: at("13:30") },
        { clock_in_at: at("08:50"), clock_out_at: at("17:00") },
      ],
      now: at("18:00"),
      tz: TZ,
    });
    expect(result.first_in).toBe(at("08:50"));
    expect(result.late_minutes).toBe(0);
  });
});

describe("deriveDay — duration and status", () => {
  it("counts a full day as present", () => {
    const result = deriveDay({
      employee: DAY,
      sessions: [{ clock_in_at: at("09:00"), clock_out_at: at("17:00") }],
      now: at("18:00"),
      tz: TZ,
    });
    expect(result.stay_seconds).toBe(8 * 3600);
    expect(result.status).toBe("present");
    expect(result.planned_seconds).toBe(8 * 3600);
  });

  it("sums multiple sessions rather than spanning the gap between them", () => {
    // 09:00-12:00 plus 13:00-17:00 is 7 hours worked, not the 8 hours between
    // the first punch and the last.
    const result = deriveDay({
      employee: DAY,
      sessions: [
        { clock_in_at: at("09:00"), clock_out_at: at("12:00") },
        { clock_in_at: at("13:00"), clock_out_at: at("17:00") },
      ],
      now: at("18:00"),
      tz: TZ,
    });
    expect(result.stay_seconds).toBe(7 * 3600);
  });

  it("downgrades a short day to half day", () => {
    const result = deriveDay({
      employee: DAY,
      sessions: [{ clock_in_at: at("09:00"), clock_out_at: at("11:00") }],
      now: at("18:00"),
      tz: TZ,
    });
    expect(result.stay_seconds).toBe(2 * 3600);
    expect(result.status).toBe("half_day");
  });

  it("keeps someone still clocked in as present, not half day", () => {
    const result = deriveDay({
      employee: DAY,
      sessions: [{ clock_in_at: at("09:00"), clock_out_at: null }],
      now: at("09:30"),
      tz: TZ,
    });
    expect(result.status).toBe("present");
    expect(result.last_out).toBeNull();
  });

  it("does not bank unverified time for an open session", () => {
    const result = deriveDay({
      employee: DAY,
      sessions: [{ clock_in_at: at("09:00"), clock_out_at: null }],
      now: at("15:00"),
      tz: TZ,
    });
    // Six hours are unproven until a clock-out lands.
    expect(result.stay_seconds).toBe(0);
  });

  it("picks half day as the boundary", () => {
    expect(HALF_DAY_SECONDS).toBe(4 * 3600);
  });
});

describe("deriveDay — early exit and overtime", () => {
  it("flags leaving well before the shift end", () => {
    const result = deriveDay({
      employee: DAY,
      sessions: [{ clock_in_at: at("09:00"), clock_out_at: at("13:00") }],
      now: at("18:00"),
      tz: TZ,
    });
    expect(result.early_exit).toBe(true);
    expect(result.overtime_seconds).toBe(0);
  });

  it("tolerates leaving within half an hour of the shift end", () => {
    const result = deriveDay({
      employee: DAY,
      sessions: [{ clock_in_at: at("09:00"), clock_out_at: at("16:40") }],
      now: at("18:00"),
      tz: TZ,
    });
    expect(result.early_exit).toBe(false);
  });

  it("counts overtime past the shift end", () => {
    const result = deriveDay({
      employee: DAY,
      sessions: [{ clock_in_at: at("09:00"), clock_out_at: at("18:30") }],
      now: at("19:00"),
      tz: TZ,
    });
    expect(result.overtime_seconds).toBe(90 * 60);
    expect(result.early_exit).toBe(false);
  });

  it("never reports negative overtime for a normal departure", () => {
    const result = deriveDay({
      employee: DAY,
      sessions: [{ clock_in_at: at("09:00"), clock_out_at: at("17:00") }],
      now: at("18:00"),
      tz: TZ,
    });
    expect(result.overtime_seconds).toBe(0);
  });
});

describe("deriveDay — overnight shifts", () => {
  // 21:00 → 05:00. The rule under test is *attribution*: a punch after midnight
  // belongs to the shift that began the previous evening, not to a 21:00 that
  // has not happened yet.
  const NIGHT = { shift_start: 1260, shift_end: 300 };

  it("measures a 02:00 punch against the previous evening's 21:00 start", () => {
    const result = deriveDay({
      employee: NIGHT,
      sessions: [{ clock_in_at: at("02:00", "2026-09-26"), clock_out_at: at("05:00", "2026-09-26") }],
      now: at("06:00", "2026-09-26"),
      graceMinutes: 15,
      tz: TZ,
    });
    // 02:00 is five hours after 21:00 the night before, less 15 minutes grace.
    // Attributing it to 21:00 *tonight* instead would give 1125, and treating
    // it as a 09:00 day shift would give a nonsense number.
    expect(result.late_minutes).toBe(285);
  });

  it("is on time for a punch inside the grace window after start", () => {
    // 21:00 start, punch at 21:10 — inside the 15-minute grace.
    const result = deriveDay({
      employee: NIGHT,
      sessions: [{ clock_in_at: at("21:10", "2026-09-25"), clock_out_at: at("05:00", "2026-09-26") }],
      now: at("06:00", "2026-09-26"),
      graceMinutes: 15,
      tz: TZ,
    });
    expect(result.late_minutes).toBe(0);
    expect(result.punctuality).toBe("on_time");
  });

  it("charges the minutes past grace on a night shift", () => {
    // 21:30 is 30 minutes late, so 15 after grace.
    const result = deriveDay({
      employee: NIGHT,
      sessions: [{ clock_in_at: at("21:30", "2026-09-25"), clock_out_at: at("05:00", "2026-09-26") }],
      now: at("06:00", "2026-09-26"),
      graceMinutes: 15,
      tz: TZ,
    });
    expect(result.late_minutes).toBe(15);
  });

  it("does not report absurd overtime when a night shift ends at 05:00", () => {
    // Shift end is 05:00, so leaving then is on time, not 19 hours over.
    const result = deriveDay({
      employee: NIGHT,
      sessions: [{ clock_in_at: at("21:30", "2026-09-25"), clock_out_at: at("05:00", "2026-09-26") }],
      now: at("06:00", "2026-09-26"),
      tz: TZ,
    });
    expect(result.overtime_seconds).toBe(0);
    expect(result.early_exit).toBe(false);
  });

  it("uses the full 8 hours as the planned length", () => {
    const result = deriveDay({
      employee: NIGHT,
      sessions: [{ clock_in_at: at("02:00", "2026-09-26"), clock_out_at: at("05:00", "2026-09-26") }],
      now: at("06:00", "2026-09-26"),
      tz: TZ,
    });
    expect(result.planned_seconds).toBe(8 * 3600);
  });
});

describe("deriveDay — timezone correctness", () => {
  it("anchors the shift to company time, not the runtime's zone", () => {
    // The same instant is 13:30Z. Read as UTC that is after the 09:00 shift has
    // begun; read as Karachi local (18:30) it is also past. The discriminating
    // case is 04:30Z = 09:30 local: a UTC-reading implementation would call this
    // "shift not started" and hide a late arrival.
    const instant = companyTimeOnDay("2026-09-25T12:00:00Z", 9 * 60 + 30, TZ).toISOString();
    expect(minutesSinceCompanyMidnight(instant, TZ)).toBe(570);

    const result = deriveDay({
      employee: DAY,
      sessions: [{ clock_in_at: instant, clock_out_at: at("17:00") }],
      now: instant,
      graceMinutes: 15,
      tz: TZ,
    });
    // 30 minutes late, minus 15 grace.
    expect(result.late_minutes).toBe(15);
    expect(result.status).toBe("present");
  });

  it("agrees with itself when the company is behind UTC", () => {
    const behind = "America/New_York";
    // 08:00 in New York on 25 Sep is 12:00Z.
    const instant = companyTimeOnDay("2026-09-25T12:00:00Z", 8 * 60, behind).toISOString();

    const beforeShift = deriveDay({
      employee: DAY,
      sessions: [],
      now: companyTimeOnDay("2026-09-25T12:00:00Z", 7 * 60, behind).toISOString(),
      tz: behind,
    });
    expect(beforeShift.status).toBe("shift_not_started");

    const afterShift = deriveDay({
      employee: DAY,
      sessions: [],
      now: companyTimeOnDay("2026-09-25T12:00:00Z", 10 * 60, behind).toISOString(),
      tz: behind,
    });
    expect(afterShift.status).toBe("absent");
  });
});

describe("shiftStartsInMinutes", () => {
  it("counts down to a shift starting later today", () => {
    expect(shiftStartsInMinutes(at("06:00"), 540, TZ)).toBe(180);
  });

  it("reports the start as imminent rather than a full day away", () => {
    // Exactly at the shift start the countdown is zero, not 24 hours: an
    // employee watching a "starts in 24h" chip at 09:00 has lost trust in it.
    expect(shiftStartsInMinutes(at("09:00"), 540, TZ)).toBe(0);
  });

  it("wraps to tomorrow for a shift that already started today", () => {
    // 12:00 local against a 09:00 start: the next start is tomorrow morning.
    expect(shiftStartsInMinutes(at("12:00"), 540, TZ)).toBe(1260);
  });
});

describe("summariseDay", () => {
  const row = (over = {}) => ({
    status: "present",
    punctuality: "on_time",
    early_exit: false,
    overtime_seconds: 0,
    ...over,
  });

  it("keeps absent and shift-not-started as different populations", () => {
    const s = summariseDay([
      row(),
      row({ status: "absent" }),
      row({ status: "shift_not_started" }),
    ]);
    expect(s.total).toBe(3);
    expect(s.present).toBe(1);
    expect(s.absent).toBe(1);
    // This is the spec's headline rule: an unstarted shift is not an absence.
    expect(s.shift_not_started).toBe(1);
  });

  it("splits present into on time and late", () => {
    const s = summariseDay([
      row(),
      row({ punctuality: "late" }),
      row({ status: "late" }),
    ]);
    expect(s.present).toBe(3);
    expect(s.late).toBe(2);
    expect(s.on_time).toBe(1);
  });

  it("derives on-time arrival and on-time exit", () => {
    const s = summariseDay([
      row(),
      row({ punctuality: "late" }),
      row({ early_exit: true }),
    ]);
    // Three present; one late and one early exit, each counted independently.
    expect(s.on_time_arrival).toBe(2);
    expect(s.on_time_exit).toBe(2);
  });

  it("counts early exits and overtime independently of status", () => {
    const s = summariseDay([
      row({ early_exit: true }),
      row({ status: "half_day", overtime_seconds: 3600 }),
    ]);
    expect(s.early_exit).toBe(1);
    expect(s.overtime).toBe(1);
    expect(s.half_day).toBe(1);
  });

  it("never reports a negative on-time figure", () => {
    const s = summariseDay([row({ status: "absent", early_exit: true })]);
    expect(s.on_time_exit).toBe(0);
  });

  it("handles an empty day", () => {
    expect(summariseDay([]).total).toBe(0);
  });
});

describe("departmentAttendance", () => {
  it("ranks the worst department first", () => {
    const rows = [
      { department_name: "Sales", status: "present" },
      { department_name: "Accounts", status: "absent" },
      { department_name: "Sales", status: "absent" },
    ];
    const result = departmentAttendance(rows);
    expect(result[0].name).toBe("Accounts");
    expect(result[0].pct).toBe(0);
    expect(result[1].pct).toBe(50);
  });

  it("groups unassigned employees rather than dropping them", () => {
    const result = departmentAttendance([{ status: "present" }]);
    expect(result[0].name).toBe("Unassigned");
  });
});

describe("weeklyTrend", () => {
  it("returns seven days oldest first ending on the given day", () => {
    const days = weeklyTrend([], at("18:00"), TZ);
    expect(days).toHaveLength(7);
    expect(days[6].date).toBe("2026-09-25");
    expect(days[0].date).toBe("2026-09-19");
  });

  it("buckets each day into its own percentage", () => {
    const rows = [
      { date: "2026-09-25", status: "present" },
      { date: "2026-09-25", status: "absent" },
      { date: "2026-09-24", status: "present" },
    ];
    const days = weeklyTrend(rows, at("18:00"), TZ);
    expect(days.find((d) => d.date === "2026-09-25").pct).toBe(50);
    expect(days.find((d) => d.date === "2026-09-24").pct).toBe(100);
    expect(days.find((d) => d.date === "2026-09-23").pct).toBe(0);
  });
});

describe("attendanceChips", () => {
  it("offers the filter set the spec asks for", () => {
    const chips = attendanceChips([{ status: "present" }, { status: "absent" }]);
    expect(chips.map((c) => c.key)).toEqual(["all", "present", "absent", "late", "on_time"]);
    expect(chips[0].count).toBe(2);
    expect(chips[2].count).toBe(1);
  });
});
describe("matchesStatusFilter", () => {
  const late = { status: "present", punctuality: "late" };
  const onTime = { status: "present", punctuality: "on_time" };
  const absent = { status: "absent", punctuality: null };
  const notStarted = { status: "shift_not_started", punctuality: null };
  const everyone = [late, onTime, absent, notStarted];

  it("passes everything through for 'all' and an empty filter", () => {
    expect(everyone.filter((r) => matchesStatusFilter(r, "all"))).toHaveLength(4);
    expect(everyone.filter((r) => matchesStatusFilter(r, ""))).toHaveLength(4);
    expect(everyone.filter((r) => matchesStatusFilter(r, null))).toHaveLength(4);
  });

  it("treats 'present' as attendance, not as punctuality", () => {
    // Someone 40 minutes late is still present; a chip reading "Present" that
    // hid them would make the counts lie.
    expect(matchesStatusFilter(late, "present")).toBe(true);
    expect(matchesStatusFilter(onTime, "present")).toBe(true);
    expect(matchesStatusFilter(absent, "present")).toBe(false);
    expect(matchesStatusFilter(notStarted, "present")).toBe(false);
  });

  it("filters on punctuality for late and on-time", () => {
    expect(matchesStatusFilter(late, "late")).toBe(true);
    expect(matchesStatusFilter(onTime, "late")).toBe(false);
    expect(matchesStatusFilter(absent, "late")).toBe(false);
    expect(matchesStatusFilter(onTime, "on_time")).toBe(true);
    expect(matchesStatusFilter(late, "on_time")).toBe(false);
  });

  it("falls back to an exact status match for the rest", () => {
    expect(matchesStatusFilter(absent, "absent")).toBe(true);
    expect(matchesStatusFilter(notStarted, "shift_not_started")).toBe(true);
    expect(matchesStatusFilter(onTime, "half_day")).toBe(false);
  });

  it("keeps 'absent' from matching an unstarted shift", () => {
    expect(matchesStatusFilter(notStarted, "absent")).toBe(false);
  });
});
