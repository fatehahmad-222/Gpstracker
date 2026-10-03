/**
 * Sidebar / navigation configuration for the GPS Work Force Monitor module.
 *
 * Single source of truth for routes, accent colours and RBAC. The shell renders
 * from this; nothing hardcodes a href elsewhere.
 *
 * `comingSoon: true` marks a reference-product entry that the spec left
 * un-specified (◇). Those render as a real route with an empty state so the
 * navigation is complete, but we deliberately do not invent behaviour.
 */

export const NAV = [
  {
    key: "dashboard",
    label: "Dashboard",
    href: "/monitor",
    icon: "LayoutDashboard",
    accent: "brand",
    exact: true,
  },
  {
    key: "configuration",
    label: "Configuration",
    icon: "Settings2",
    accent: "orange",
    children: [
      { key: "departments", label: "Departments", href: "/monitor/configuration/departments" },
      { key: "sub-departments", label: "Sub Departments", href: "/monitor/configuration/sub-departments" },
      { key: "designations", label: "Designations", href: "/monitor/configuration/designations" },
      { key: "policies", label: "Policies", href: "/monitor/configuration/policies" },
    ],
  },
  {
    key: "command-center",
    label: "Command Center",
    href: "/monitor/command-center",
    icon: "Radar",
    accent: "purple",
  },
  {
    key: "employees",
    label: "Employees",
    href: "/monitor/employees",
    icon: "Users",
    accent: "teal",
  },
  {
    key: "teams",
    label: "Teams",
    href: "/monitor/teams",
    icon: "UserRoundPlus",
    accent: "lime",
    comingSoon: true,
  },
  {
    key: "geofencing",
    label: "Geofencing",
    icon: "MapPinned",
    accent: "gold",
    children: [
      { key: "fences", label: "Locations / Fences", href: "/monitor/geofencing" },
      { key: "routes", label: "Routes", href: "/monitor/geofencing/routes" },
      { key: "pick", label: "Pick on Map", href: "/monitor/geofencing/pick" },
    ],
  },
  {
    key: "attendance",
    label: "Geo Tracking Attendance",
    icon: "MapPinCheck",
    accent: "sky",
    children: [
      { key: "attendance-views", label: "Attendance", href: "/monitor/attendance" },
      { key: "attendance-logs", label: "Logs", href: "/monitor/attendance/logs" },
    ],
  },
  {
    key: "field-visit",
    label: "Field Visit",
    href: "/monitor/field-visit",
    icon: "Route",
    accent: "rose",
    comingSoon: true,
  },
  {
    key: "leaves",
    label: "Leaves",
    href: "/monitor/leaves",
    icon: "CalendarDays",
    accent: "amber",
    comingSoon: true,
  },
  {
    key: "tracking",
    label: "Tracking",
    icon: "Radar",
    accent: "blue",
    children: [
      { key: "live-tracker", label: "Live Tracker", href: "/tracker" },
    ],
  },
  {
    key: "schedule",
    label: "Schedule",
    href: "/monitor/schedule",
    icon: "CalendarRange",
    accent: "green",
    comingSoon: true,
  },
  {
    key: "alerts",
    label: "Alerts & Violation",
    href: "/monitor/alerts",
    icon: "ShieldAlert",
    accent: "red",
    // Implemented in Phase 6 (consumes the signals engine), not a placeholder.
    comingSoon: true,
  },
  {
    key: "loans",
    label: "Loan & Requests",
    href: "/monitor/loans",
    icon: "HandCoins",
    accent: "slate",
    comingSoon: true,
  },
  {
    key: "task-manager",
    label: "Task Manager",
    href: "/monitor/tasks",
    icon: "ListChecks",
    accent: "indigo",
    comingSoon: true,
  },
  {
    key: "payroll",
    label: "Payroll Processing",
    href: "/monitor/payroll",
    icon: "Wallet",
    accent: "yellow",
    comingSoon: true,
  },
  {
    key: "reports",
    label: "Reports",
    href: "/monitor/reports",
    icon: "FileBarChart",
    accent: "slate",
    comingSoon: true,
    faded: true,
  },
  {
    key: "timekeeper",
    label: "Timekeeper",
    href: "/monitor/timekeeper",
    icon: "Timer",
    accent: "slate",
    comingSoon: true,
    faded: true,
  },
  {
    key: "crm",
    label: "CRM",
    href: "/monitor/crm",
    icon: "Handshake",
    accent: "slate",
    comingSoon: true,
    faded: true,
  },
];

/** Flattened href list — used by middleware-style route gating. */
export const NAV_HREFS = NAV.flatMap((item) =>
  item.children ? [item.href, ...item.children.map((c) => c.href)] : [item.href]
).filter(Boolean);

/**
 * Rounded-square icon-tile accents. Each module gets its own colour, matching
 * the reference product's sidebar.
 */
export const ACCENTS = {
  brand: { bg: "#1F7F6B", fg: "#ffffff" },
  teal: { bg: "#14B8A6", fg: "#ffffff" },
  orange: { bg: "#F97316", fg: "#ffffff" },
  purple: { bg: "#8B5CF6", fg: "#ffffff" },
  lime: { bg: "#22C55E", fg: "#05240F" },
  gold: { bg: "#EAB308", fg: "#3B2E00" },
  sky: { bg: "#0EA5E9", fg: "#ffffff" },
  blue: { bg: "#3B82F6", fg: "#ffffff" },
  green: { bg: "#16A34A", fg: "#ffffff" },
  rose: { bg: "#F43F5E", fg: "#ffffff" },
  red: { bg: "#DC2626", fg: "#ffffff" },
  amber: { bg: "#F59E0B", fg: "#3B2E00" },
  slate: { bg: "#64748B", fg: "#ffffff" },
  indigo: { bg: "#6366F1", fg: "#ffffff" },
  yellow: { bg: "#FACC15", fg: "#3B2E00" },
};

/** Routes an `employee` role may reach. Everyone else needs admin/viewer. */
export const EMPLOYEE_ALLOWED_PREFIXES = ["/tracker", "/monitor/attendance"];

export function isNavItemActive(item, pathname) {
  if (!item.href) return false;
  if (item.exact) return pathname === item.href;
  if (item.children) {
    return (
      pathname === item.href ||
      item.children.some((c) => pathname === c.href || pathname.startsWith(`${c.href}/`))
    );
  }
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

export function canAccessPath(pathname, role) {
  if (role === "admin" || role === "viewer") return true;
  return EMPLOYEE_ALLOWED_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`)
  );
}