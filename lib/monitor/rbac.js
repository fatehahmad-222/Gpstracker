/**
 * RBAC for the monitor module.
 *
 * Roles: `admin` (full control), `viewer` (read-only), `employee`
 * (self-service only). Mirrors the `profiles.role` CHECK in migration 0003.
 *
 * Enforced in three places, all of which must agree:
 *   1. the shell        — hides menu items
 *   2. the page         — redirects when a role has no access
 *   3. RLS             — the real boundary (migrations 0003-0010)
 */

export const ROLES = ["admin", "viewer", "employee"];

/**
 * Module-level capabilities. `read` gates visibility, `write` gates mutations.
 */
export const CAPABILITIES = {
  dashboard: { read: ["admin", "viewer"], write: ["admin"] },
  command_center: { read: ["admin", "viewer"], write: ["admin"] },
  employees: { read: ["admin", "viewer"], write: ["admin"] },
  configuration: { read: ["admin", "viewer"], write: ["admin"] },
  policies: { read: ["admin", "viewer"], write: ["admin"] },
  geofencing: { read: ["admin", "viewer", "employee"], write: ["admin"] },
  attendance: { read: ["admin", "viewer", "employee"], write: ["admin"] },
  tracker: { read: ["admin", "viewer", "employee"], write: ["admin"] },
  leaves: { read: ["admin", "viewer", "employee"], write: ["admin"] },
  audit: { read: ["admin", "viewer"], write: ["admin"] },
};

export function can(role, capability, mode = "read") {
  const entry = CAPABILITIES[capability];
  if (!entry) return false;
  const allowed = entry[mode];
  if (!allowed) return false;
  return allowed.includes(role);
}

export function isStaff(role) {
  return role === "admin" || role === "viewer";
}

export function isAdmin(role) {
  return role === "admin";
}

/** Route guard used by the monitor layout. Returns a redirect path or null. */
export function guardMonitorPath(pathname, role) {
  if (role === "admin" || role === "viewer") return null;

  if (role === "employee") {
    const allowed = ["/tracker", "/monitor/attendance"];
    if (allowed.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return null;
    return "/monitor/attendance";
  }

  // Unknown role: fail closed.
  return "/dashboard";
}

/** Home route for each role after sign-in. */
export function homeForRole(role) {
  switch (role) {
    case "admin":
    case "viewer":
      return "/monitor";
    case "employee":
      return "/tracker";
    default:
      return "/dashboard";
  }
}

/** Human label for the top-bar user menu. */
export function roleLabel(role) {
  switch (role) {
    case "admin":
      return "Administrator";
    case "viewer":
      return "Viewer";
    case "employee":
      return "Employee";
    default:
      return "Member";
  }
}