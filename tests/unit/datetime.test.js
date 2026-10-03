import { describe, it, expect } from "vitest";
import {
  DEFAULT_TZ,
  toCompanyDate,
  formatLongDate,
  formatUsDate,
  formatMonthYear,
  formatDayWithWeekday,
  formatClockTime,
  formatDuration,
  formatAge,
  minutesToLabel,
  labelToMinutes,
  shiftRangeLabel,
  isOvernightShift,
  shiftLengthMinutes,
  companyDayRange,
  addDays,
  daysBetween,
  minutesSinceCompanyMidnight,
  companyTimeOnDay,
} from "@/lib/monitor/datetime";

/** 2026-10-03T20:00:00Z is 2026-10-04 01:00 in Karachi (UTC+5). */
const LATE_UTC = "2026-10-03T20:00:00.000Z";

describe("timezone handling", () => {
  it("defaults to Karachi", () => {
    expect(DEFAULT_TZ).toBe("Asia/Karachi");
  });

  it("rolls the date forward across the UTC boundary", () => {
    // 20:00Z is already the 4th in PKT
    expect(toCompanyDate(LATE_UTC)).toBe("2026-10-04");
  });

  it("keeps the date behind for an evening UTC time", () => {
    // 10:00Z is 15:00 the same day in PKT
    expect(toCompanyDate("2026-10-03T10:00:00.000Z")).toBe("2026-10-03");
  });

  it("accepts a plain date string unchanged", () => {
    expect(toCompanyDate("2026-10-03")).toBe("2026-10-03");
  });

  it("accepts a Date", () => {
    expect(toCompanyDate(new Date(LATE_UTC))).toBe("2026-10-04");
  });
});

describe("formatting", () => {
  it("formats a long date", () => {
    expect(formatLongDate(LATE_UTC)).toMatch(/October/);
    expect(formatLongDate(LATE_UTC)).toMatch(/2026/);
  });

  it("formats a US date", () => {
    expect(formatUsDate(LATE_UTC)).toBe("10/04/2026");
  });

  it("formats month and year", () => {
    expect(formatMonthYear(LATE_UTC)).toMatch(/2026/);
  });

  it("formats a day with weekday", () => {
    expect(formatDayWithWeekday(LATE_UTC)).toMatch(/\w{3}/);
  });

  it("formats clock time in company time", () => {
    expect(formatClockTime(LATE_UTC)).toBe("01:00 AM");
  });

  it("handles an invalid date without throwing", () => {
    expect(() => formatClockTime("not-a-date")).not.toThrow();
  });
});

describe("formatDuration", () => {
  it("formats hours, minutes and seconds", () => {
    expect(formatDuration(3600 * 7 + 60 * 30 + 6)).toBe("7h 30m 6s");
  });

  it("formats minutes and seconds", () => {
    expect(formatDuration(60 * 34 + 17)).toBe("34m 17s");
  });

  it("formats bare seconds", () => {
    expect(formatDuration(9)).toBe("9s");
  });

  it("is zero seconds for no input", () => {
    expect(formatDuration(0)).toBe("0s");
  });

  it("is an em dash for null", () => {
    expect(formatDuration(null)).toBe("—");
  });

  it("clamps a negative duration to zero", () => {
    expect(formatDuration(-500)).toBe("0s");
  });
});

describe("formatAge", () => {
  const now = Date.parse("2026-10-03T12:00:00.000Z");

  it("says just now inside the first minute", () => {
    expect(formatAge("2026-10-03T11:59:58.000Z", now)).toBe("just now");
  });

  it("reports minutes", () => {
    expect(formatAge("2026-10-03T11:45:00.000Z", now)).toBe("15 m");
  });

  it("reports hours", () => {
    expect(formatAge("2026-10-03T09:00:00.000Z", now)).toBe("3 h");
  });

  it("reports days beyond 48 hours", () => {
    expect(formatAge("2026-10-01T12:00:00.000Z", now)).toBe("2 d");
  });

  it("treats a null timestamp as never synced", () => {
    expect(formatAge(null)).toBe("never");
  });

  it("treats an unparseable timestamp as never synced", () => {
    expect(formatAge("not-a-date")).toBe("never");
  });
});

describe("shift labels", () => {
  it("converts minutes to a 12-hour label", () => {
    expect(minutesToLabel(9 * 60)).toBe("09:00 AM");
    expect(minutesToLabel(13 * 60 + 30)).toBe("01:30 PM");
    expect(minutesToLabel(0)).toBe("12:00 AM");
    expect(minutesToLabel(12 * 60)).toBe("12:00 PM");
  });

  it("converts a label back to minutes", () => {
    expect(labelToMinutes(9, 0, "AM")).toBe(540);
    expect(labelToMinutes(1, 30, "PM")).toBe(810);
    expect(labelToMinutes(12, 0, "AM")).toBe(0);
    expect(labelToMinutes(12, 0, "PM")).toBe(720);
  });

  it("round-trips a label", () => {
    for (const mins of [0, 540, 720, 810, 1439]) {
      const [time, meridiem] = minutesToLabel(mins).split(" ");
      const [h, m] = time.split(":").map(Number);
      expect(labelToMinutes(h, m, meridiem)).toBe(mins);
    }
  });

  it("renders a shift range", () => {
    expect(shiftRangeLabel(540, 1020)).toBe("09:00 AM - 05:00 PM");
  });

  it("marks an overnight shift", () => {
    expect(isOvernightShift(1260, 360)).toBe(true);
    expect(isOvernightShift(540, 1020)).toBe(false);
  });

  it("treats identical start and end as a 24h shift", () => {
    // A zero-length shift is invalid data; the shape stays a full day rather
    // than a negative or zero length, which is what the DB CHECK should catch.
    expect(isOvernightShift(540, 540)).toBe(true);
    expect(shiftLengthMinutes(540, 540)).toBe(1440);
  });

  it("measures shift length across midnight", () => {
    expect(shiftLengthMinutes(540, 1020)).toBe(480);
    // 21:00 -> 06:00 is nine hours.
    expect(shiftLengthMinutes(1260, 360)).toBe(540);
  });
});

describe("companyDayRange", () => {
  it("spans a full day in company time", () => {
    const { from, to } = companyDayRange("2026-10-03");
    // PKT is UTC+5, so the day starts at 19:00Z the previous day.
    expect(from).toBe("2026-10-02T19:00:00.000Z");
    expect(to).toBe("2026-10-03T19:00:00.000Z");
  });

  it("returns exactly 24 hours", () => {
    const { from, to } = companyDayRange("2026-10-03");
    expect(Date.parse(to) - Date.parse(from)).toBe(24 * 3600 * 1000);
  });
});

describe("date arithmetic", () => {
  it("adds days", () => {
    expect(addDays("2026-10-03", 1)).toBe("2026-10-04");
  });

  it("crosses a month boundary", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
  });

  it("handles a negative offset", () => {
    expect(addDays("2026-10-03", -3)).toBe("2026-09-30");
  });

  it("counts days between dates", () => {
    expect(daysBetween("2026-10-01", "2026-10-03")).toBe(2);
  });

  it("is zero for the same day", () => {
    expect(daysBetween("2026-10-03", "2026-10-03")).toBe(0);
  });
});
describe("minutesSinceCompanyMidnight", () => {
  it("reads the company clock, not the runtime's", () => {
    // 20:00Z on 3 Oct is 01:00 on 4 Oct in Karachi: 60 minutes, not 1200.
    expect(minutesSinceCompanyMidnight(LATE_UTC, DEFAULT_TZ)).toBe(60);
  });

  it("matches the wall clock inside the company's own day", () => {
    // 04:00Z is 09:00 in Karachi.
    expect(minutesSinceCompanyMidnight("2026-10-03T04:00:00Z", DEFAULT_TZ)).toBe(9 * 60);
  });

  it("stays within a single day", () => {
    for (const hour of [0, 6, 12, 18, 23]) {
      const value = minutesSinceCompanyMidnight(`2026-10-03T${String(hour).padStart(2, "0")}:00:00Z`, DEFAULT_TZ);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1440);
    }
  });

  it("handles a zone behind UTC", () => {
    // 12:00Z is 08:00 in New York in September (UTC-4).
    expect(minutesSinceCompanyMidnight("2026-10-03T12:00:00Z", "America/New_York")).toBe(8 * 60);
  });

  it("treats midnight as zero", () => {
    // 19:00Z on 3 Oct is exactly midnight on 4 Oct in Karachi.
    expect(minutesSinceCompanyMidnight("2026-10-03T19:00:00Z", DEFAULT_TZ)).toBe(0);
  });

  it("returns zero for an unparseable value rather than NaN", () => {
    expect(minutesSinceCompanyMidnight("not a date", DEFAULT_TZ)).toBe(0);
  });
});

describe("companyTimeOnDay", () => {
  it("round-trips with minutesSinceCompanyMidnight", () => {
    const instant = companyTimeOnDay("2026-10-03T12:00:00Z", 9 * 60 + 30, DEFAULT_TZ);
    expect(minutesSinceCompanyMidnight(instant, DEFAULT_TZ)).toBe(9 * 60 + 30);
  });

  it("produces 09:00 Karachi as 04:00Z", () => {
    expect(companyTimeOnDay("2026-10-03T12:00:00Z", 540, DEFAULT_TZ).toISOString()).toBe(
      "2026-10-03T04:00:00.000Z"
    );
  });

  it("accepts minutes before midnight to reach the previous evening", () => {
    // -180 from local midnight on 4 Oct is 21:00 on 3 Oct, i.e. 16:00Z.
    expect(companyTimeOnDay(LATE_UTC, -180, DEFAULT_TZ).toISOString()).toBe(
      "2026-10-03T16:00:00.000Z"
    );
  });

  it("stays on the requested company day across a UTC day boundary", () => {
    // 02:00 local on 4 Oct is 21:00Z on 3 Oct, so the UTC date differs from the
    // company date and the helper must still resolve to the 4th.
    const instant = companyTimeOnDay(LATE_UTC, 120, DEFAULT_TZ);
    expect(toCompanyDate(instant, DEFAULT_TZ)).toBe("2026-10-04");
  });
});
