import {
  Radar,
  LayoutDashboard,
  MapPinCheck,
  Users,
  ListChecks,
  Clock,
  ShieldAlert,
  CalendarDays,
  MapPinned,
  Settings2,
  UserRoundPlus,
  Route,
  CalendarRange,
  HandCoins,
  Wallet,
  FileBarChart,
  Timer,
  Handshake,
  Building2,
  Network,
  Briefcase,
  Smartphone,
  FileText,
  CircleDot,
  Layers,
} from "lucide-react";

/**
 * Single source of truth for the admin console's routes.
 *
 * The shell renders from this and nothing hardcodes a href, which matters more
 * than usual here: these pages arrived from the old standalone /monitor product,
 * and the point of folding them in is that one sidebar now describes the whole
 * console. Icons are lucide components rather than the string names the monitor
 * used, because the admin shell draws them directly and a string table needs a
 * parallel lookup table beside it.
 *
 * `planned: true` marks a tab that exists as a route but has no implementation
 * yet. They are listed rather than hidden so the console's shape is visible
 * while it is being built, and they are muted so they do not read as working.
 */
export const NAV = [
  { href: "/dashboard", label: "Overview", icon: Radar, exact: true },
  { href: "/dashboard/command-center", label: "Command Center", icon: LayoutDashboard },
  { href: "/dashboard/live-map", label: "Live Map", icon: MapPinCheck },
  { href: "/dashboard/employees", label: "Employees", icon: Users },
  { href: "/dashboard/tasks", label: "Tasks", icon: ListChecks },

  {
    href: "/dashboard/attendance",
    label: "Attendance",
    icon: Clock,
    children: [
      { href: "/dashboard/attendance", label: "Today", icon: Clock },
      { href: "/dashboard/attendance/logs", label: "Logs", icon: FileText },
    ],
  },

  { href: "/dashboard/alerts", label: "Alerts & Violations", icon: ShieldAlert },
  { href: "/dashboard/leaves", label: "Leaves", icon: CalendarDays },

  {
    href: "/dashboard/geofencing",
    label: "Geofencing",
    icon: MapPinned,
    children: [
      { href: "/dashboard/geofencing", label: "Locations & Fences", icon: MapPinned },
      { href: "/dashboard/geofencing/routes", label: "Routes", icon: Route },
      { href: "/dashboard/geofencing/pick", label: "Pick on Map", icon: CircleDot },
    ],
  },

  {
    href: "/dashboard/configuration/departments",
    label: "Configuration",
    icon: Settings2,
    children: [
      { href: "/dashboard/configuration/departments", label: "Departments", icon: Building2 },
      { href: "/dashboard/configuration/sub-departments", label: "Sub Departments", icon: Network },
      { href: "/dashboard/configuration/designations", label: "Designations", icon: Briefcase },
      { href: "/dashboard/configuration/policies", label: "Policies", icon: FileText },
      { href: "/dashboard/configuration/devices", label: "Devices", icon: Smartphone },
    ],
  },

  // --- Routes that exist but have no implementation yet -------------------
  { href: "/dashboard/teams", label: "Teams", icon: UserRoundPlus, planned: true },
  { href: "/dashboard/field-visit", label: "Field Visit", icon: Layers, planned: true },
  { href: "/dashboard/schedule", label: "Schedule", icon: CalendarRange, planned: true },
  { href: "/dashboard/loans", label: "Loan & Requests", icon: HandCoins, planned: true },
  { href: "/dashboard/payroll", label: "Payroll Processing", icon: Wallet, planned: true },
  { href: "/dashboard/reports", label: "Reports", icon: FileBarChart, planned: true },
  { href: "/dashboard/timekeeper", label: "Timekeeper", icon: Timer, planned: true },
  { href: "/dashboard/crm", label: "CRM", icon: Handshake, planned: true },
];

/**
 * Every href the nav points at, flattened and deduplicated. Used by tests and
 * the E2E crawl.
 *
 * The dedupe matters: a group's own href is normally repeated by its first
 * child ("Attendance" -> "Today" both being /dashboard/attendance), and a
 * caller asserting on coverage should see each route once.
 */
export const NAV_HREFS = [
  ...new Set(
    NAV.flatMap((item) =>
      item.children ? [item.href, ...item.children.map((c) => c.href)] : [item.href]
    ).filter(Boolean)
  ),
];

/**
 * Active-state match.
 *
 * `exact` is for the console root, where `/dashboard` must not light up while
 * the user is three sections deep. Everything else matches on segment
 * boundaries rather than a bare prefix, so `/dashboard/attendance` does not
 * highlight when the browser is actually on `/dashboard/attendance-logs`.
 */
export function isNavItemActive(item, pathname) {
  if (!item.href || !pathname) return false;
  if (item.exact) return pathname === item.href;
  if (item.children) {
    return (
      pathname === item.href ||
      item.children.some((c) => pathname === c.href || pathname.startsWith(`${c.href}/`))
    );
  }
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

/** The group that owns the current route, so the shell can auto-expand it. */
export function activeGroupKey(pathname) {
  const group = NAV.find((item) => item.children && isNavItemActive(item, pathname));
  return group ? group.key || group.href : null;
}