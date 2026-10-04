import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import path from "node:path";

import { NAV, NAV_HREFS, isNavItemActive, activeGroupKey } from "@/lib/dashboard/nav";

/**
 * Folding the standalone /monitor product into /dashboard replaced one sidebar
 * over a fixed tree with one sidebar over ~20 routes. The failure mode that
 * creates is a nav entry pointing at a route that does not exist, or an existing
 * route nobody linked -- both are silent, so they are pinned here.
 *
 * Note what this file no longer tests: employee reachability per nav item. That
 * is now structural -- every console route sits under app/dashboard/layout.js,
 * which calls requireRole("admin", "viewer"). An employee cannot render any of
 * them however the sidebar draws them, so a per-item access table would be a
 * second, weaker copy of a decision the layout already makes.
 */

const APP_DIR = path.join(process.cwd(), "app");

/**
 * `/dashboard/geofencing/routes` -> the page file that must exist for it.
 *
 * This repo's pages are `.js`, not `.jsx`, so both are accepted rather than
 * hard-coding one and silently passing against a renamed directory.
 */
function routeFileFor(href) {
  const dir = path.join(APP_DIR, href.replace(/^\//, ""));
  return ["page.js", "page.jsx"].map((f) => path.join(dir, f));
}

const hasRoute = (href) => routeFileFor(href).some(existsSync);

describe("console nav", () => {
  it("points only at routes inside /dashboard", () => {
    // The old product lived at /monitor. Any surviving href is a dead link.
    for (const href of NAV_HREFS) {
      expect(href === "/dashboard" || href.startsWith("/dashboard/")).toBe(true);
    }
  });

  it("has a page for every nav entry", () => {
    const missing = NAV_HREFS.filter((href) => !hasRoute(href));
    expect(missing).toEqual([]);
  });

  it("lists each destination once", () => {
    expect(NAV_HREFS.length).toBe(new Set(NAV_HREFS).size);
  });

  it("gives every entry a label and a real icon component", () => {
    for (const item of NAV.flatMap((i) => [i, ...(i.children || [])])) {
      expect(item.label).toBeTruthy();
      // The old nav stored icon *names* as strings and needed a parallel lookup
      // table beside it. These are imported lucide components -- forwardRef
      // objects, so `typeof` is "object", not "function".
      expect(typeof item.icon).not.toBe("string");
      expect(item.icon).toBeTruthy();
      expect(item.icon.$$typeof).toBe(Symbol.for("react.forward_ref"));
    }
  });

  it("keeps planned tabs visible but flagged", () => {
    // Placeholders stay listed so the console's shape is visible while it is
    // built, and muted so they do not read as working.
    const planned = NAV.filter((i) => i.planned);
    expect(planned.length).toBeGreaterThan(0);
    for (const item of planned) {
      expect(item.label).toBeTruthy();
      expect(hasRoute(item.href)).toBe(true);
    }
  });
});

describe("isNavItemActive", () => {
  const attendance = NAV.find((i) => i.href === "/dashboard/attendance");
  const overview = NAV.find((i) => i.href === "/dashboard");

  it("lights the console root only when exactly there", () => {
    expect(isNavItemActive(overview, "/dashboard")).toBe(true);
    expect(isNavItemActive(overview, "/dashboard/tasks")).toBe(false);
  });

  it("matches a group from either its own route or a child's", () => {
    expect(isNavItemActive(attendance, "/dashboard/attendance")).toBe(true);
    expect(isNavItemActive(attendance, "/dashboard/attendance/logs")).toBe(true);
  });

  it("does not leak a match into a sibling that shares a prefix", () => {
    // The bug this guards: a bare startsWith would light "Attendance" while the
    // browser is on /dashboard/attendanceX.
    expect(isNavItemActive(attendance, "/dashboard/attendanceX")).toBe(false);
    expect(isNavItemActive(attendance, "/dashboard/attendance-logs")).toBe(false);
  });

  it("treats a missing href or pathname as inactive instead of throwing", () => {
    expect(isNavItemActive({}, undefined)).toBe(false);
    expect(isNavItemActive(attendance, undefined)).toBe(false);
    expect(isNavItemActive(attendance, "")).toBe(false);
  });
});

describe("activeGroupKey", () => {
  it("names the group that owns a nested route, for auto-expand", () => {
    expect(activeGroupKey("/dashboard/attendance/logs")).toBe("/dashboard/attendance");
    expect(activeGroupKey("/dashboard/configuration/devices")).toBe(
      "/dashboard/configuration/departments"
    );
  });

  it("returns null for a route no group owns", () => {
    expect(activeGroupKey("/dashboard/tasks")).toBeNull();
    expect(activeGroupKey("/dashboard")).toBeNull();
  });
});