/**
 * Field task rules.
 *
 * `tasks` predates the monitor module: it belongs to the original Fleet Console
 * dashboard, and migration 0003 deliberately added `company_id` to it rather than
 * creating a parallel table ("reuses the existing tasks table" in the seed).
 *
 * That has one consequence worth stating plainly, because it is the only place in
 * the schema where an employee is referenced two ways:
 *
 *   tasks.employee_id  -> profiles(id)
 *   leaves.employee_id -> employees(id)
 *
 * The monitor works in `employees`, so every task write has to resolve an employee
 * to their profile id first, and an employee with no profile cannot be assigned
 * work at all. Rather than let that failure surface as a foreign key violation
 * from the database, it is turned into an explicit, actionable error here.
 */

export const TASK_STATUSES = ["pending", "in_progress", "completed", "cancelled"];

/** Pill tone per status. Only `completed` is a finished outcome. */
export const TASK_STATUS_META = {
  pending: { label: "Pending", status: "neutral" },
  in_progress: { label: "In Progress", status: "warn" },
  completed: { label: "Completed", status: "ok" },
  cancelled: { label: "Cancelled", status: "danger" },
};

/**
 * Allowed status transitions.
 *
 * `pending -> in_progress -> completed` is the working path. Completing straight
 * from pending is allowed because a task can be done on arrival and forcing a
 * pointless status change would only add taps. Cancelling is reachable from both
 * open states. Nothing moves out of `completed` or `cancelled`: a finished task
 * is history, and rewriting it would contradict the completed_at timestamp.
 */
const TRANSITIONS = {
  pending: ["in_progress", "completed", "cancelled"],
  in_progress: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
};

export function canTransition(from, to) {
  if (from === to) return false;
  return (TRANSITIONS[from] || []).includes(to);
}

export function nextStatuses(from) {
  return TRANSITIONS[from] || [];
}

export function isOpen(status) {
  return status === "pending" || status === "in_progress";
}

export const MAX_TITLE_LENGTH = 140;
export const MAX_DESCRIPTION_LENGTH = 1000;

/**
 * Validate and normalise a task.
 *
 * `employee_id` here is an *employee* id; the route is what converts it to a
 * profile id, because that mapping needs a database read and this is pure.
 */
export function validateTask(input = {}) {
  const errors = {};

  const title = typeof input.title === "string" ? input.title.trim() : "";
  if (!title) errors.title = "Give the task a title";
  else if (title.length > MAX_TITLE_LENGTH) {
    errors.title = `Title must be ${MAX_TITLE_LENGTH} characters or fewer`;
  }

  const description = typeof input.description === "string" ? input.description.trim() : "";

  const lat = Number(input.target_lat);
  const lng = Number(input.target_lng);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
    errors.target_lat = "Latitude must be between -90 and 90";
  }
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
    errors.target_lng = "Longitude must be between -180 and 180";
  }

  // Optional: a task may be assigned without a pin, for anything not site-bound.
  // Zero is a real coordinate, so the check is on emptiness, not falsiness.
  const hasPin = input.target_lat !== "" && input.target_lat != null && input.target_lng != null && input.target_lng !== "";
  const address = typeof input.target_address === "string" ? input.target_address.trim() : "";

  const radiusRaw = input.radius_meters;
  const radius = radiusRaw === "" || radiusRaw == null ? 100 : Number(radiusRaw);
  if (!Number.isFinite(radius) || radius < 0) {
    errors.radius_meters = "Radius cannot be negative";
  }

  let dueAt = null;
  if (input.due_at) {
    const parsed = new Date(input.due_at);
    if (Number.isNaN(parsed.getTime())) errors.due_at = "Due date is not a valid date";
    else dueAt = parsed.toISOString();
  }

  return {
    errors,
    value: Object.keys(errors).length === 0
      ? {
          title,
          description,
          has_pin: hasPin,
          target_lat: hasPin ? lat : null,
          target_lng: hasPin ? lng : null,
          target_address: address || null,
          radius_meters: radius,
          due_at: dueAt,
        }
      : null,
  };
}

/**
 * Resolve a task assignee.
 *
 * `tasks.employee_id` points at `profiles`, so an employee with no linked profile
 * cannot hold a task. Returning that as a named outcome rather than letting the
 * insert fail keeps the message in the UI, where somebody can act on it by
 * inviting the employee to the product first.
 */
export function resolveAssignee(employee) {
  if (!employee) return { error: "missing_employee" };
  if (employee.is_active === false) return { error: "employee_inactive" };
  if (!employee.profile_id) return { error: "employee_has_no_profile" };
  return { profileId: employee.profile_id, employeeId: employee.id };
}

export function matchesStatusFilter(row, filter) {
  if (!filter || filter === "all") return true;
  if (filter === "open") return isOpen(row?.status);
  return row?.status === filter;
}

/** Open work first, then most recently due, then newest. */
export function sortTasks(rows = []) {
  return [...rows].sort((a, b) => {
    const oa = isOpen(a.status) ? 0 : 1;
    const ob = isOpen(b.status) ? 0 : 1;
    if (oa !== ob) return oa - ob;
    const da = a.due_at || "";
    const db = b.due_at || "";
    if (da !== db) {
      // An undated task sorts after a dated one within its group: a due date is
      // the thing a supervisor triages on.
      if (!da) return 1;
      if (!db) return -1;
      return da.localeCompare(db);
    }
    return String(b.created_at || "").localeCompare(String(a.created_at || ""));
  });
}