import { describe, it, expect } from "vitest";

import { canAccessPath, NAV_HREFS, EMPLOYEE_ALLOWED_PREFIXES } from "@/lib/monitor/nav";

/**
 * `canAccessPath` became load-bearing in the monitor shell: it is what stops a
 * staff-only page rendering for an employee who typed the URL. The sidebar has
 * always hidden links an employee may not open, so these tests are the guard
 * against the two halves disagreeing.
 */

const isEmployeeReachable = (href) =>
  EMPLOYEE_ALLOWED_PREFIXES.some((p) => href === p || href.startsWith(`${p}/`));

const STAFF_ONLY = NAV_HREFS.filter((href) => !isEmployeeReachable(href));

describe("canAccessPath", () => {
  it("lets admins and viewers reach everything", () => {
    for (const role of ["admin", "viewer"]) {
      for (const href of NAV_HREFS) {
        expect(canAccessPath(href, role)).toBe(true);
      }
    }
  });

  it("denies an employee every staff-only nav destination", () => {
    // Guards the test itself: if attendance or tracker moved out of
    // EMPLOYEE_ALLOWED_PREFIXES without updating it, this would pass vacuously.
    expect(STAFF_ONLY.length).toBeGreaterThan(0);
    for (const href of STAFF_ONLY) {
      expect(canAccessPath(href, "employee")).toBe(false);
    }
  });

  it("still allows an employee their own attendance view", () => {
    // The one staff-shaped screen an employee is meant to open: their own hours.
    expect(canAccessPath("/monitor/attendance", "employee")).toBe(true);
    expect(canAccessPath("/monitor/attendance/logs", "employee")).toBe(true);
  });

  it("allows the tracker area to an employee", () => {
    expect(canAccessPath("/tracker", "employee")).toBe(true);
    expect(canAccessPath("/tracker/live", "employee")).toBe(true);
  });

  it("agrees with its own prefix list on every nav destination", () => {
    // The invariant the shell depends on: no nav entry may be visible to an
    // employee and denied by the gate, or the sidebar would link to a page that
    // immediately bounces.
    for (const href of NAV_HREFS) {
      expect(canAccessPath(href, "employee")).toBe(isEmployeeReachable(href));
    }
  });

  it("does not let a prefix match leak into a sibling route", () => {
    // "/monitor/attendancesomething" is not the attendance screen.
    expect(canAccessPath("/monitor/attendancesomething", "employee")).toBe(false);
    expect(canAccessPath("/monitor/attendanceX", "employee")).toBe(false);
    expect(canAccessPath("/trackerboard", "employee")).toBe(false);
  });

  it("denies an unknown or missing role rather than defaulting to allow", () => {
    // Failing closed matters here: a role the code does not recognise must not be
    // treated as staff.
    for (const role of [undefined, null, "", "superuser", "Admin"]) {
      expect(canAccessPath("/monitor/employees", role)).toBe(false);
    }
  });

  it("handles a missing pathname without throwing", () => {
    expect(canAccessPath(undefined, "admin")).toBe(true);
    expect(canAccessPath(undefined, "employee")).toBe(false);
    expect(canAccessPath("", "employee")).toBe(false);
  });
});