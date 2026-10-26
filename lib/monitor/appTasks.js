/**
 * Field-app task rules.
 *
 * The monitor routes are written for staff: an administrator can create a task,
 * cancel it and reopen a conversation with the employee. The field app is a much
 * narrower surface. An employee may only move their own assigned work from
 * pending to in progress to completed. In particular they may not cancel work a
 * supervisor assigned them, and they cannot produce a "geofence" completion
 * claim from the app - that provenance is reserved for the server's own
 * evidence.
 */

import { canTransition, isOpen, sortTasks } from "./fieldTasks";

export const APP_TASK_FILTERS = ["all", "open", "pending", "in_progress", "completed", "cancelled"];

export function normaliseTaskFilter(value) {
  const filter = String(value || "all").trim();
  return APP_TASK_FILTERS.includes(filter) ? filter : "all";
}

/**
 * The only transitions an employee can make from the field app.
 *
 * Completing straight from pending is allowed because a short job may be done
 * before anyone bothered to press "start". Cancelling is deliberately absent.
 */
export function employeeNextStatuses(from) {
  const allowed = ["in_progress", "completed"];
  return allowed.filter((to) => canTransition(from, to));
}

export function canEmployeeTransition(from, to) {
  return employeeNextStatuses(from).includes(to);
}

export function filterEmployeeTasks(rows = [], filter = "all") {
  const value = normaliseTaskFilter(filter);
  if (value === "all") return sortTasks(rows);
  if (value === "open") return sortTasks(rows.filter((row) => isOpen(row.status)));
  return sortTasks(rows.filter((row) => row.status === value));
}

/**
 * Completion provenance for a status change made in the app.
 *
 * Never `geofence`: the client has no server-verified arrival attached to the
 * request, and letting it name that source would turn a button tap into evidence
 * of a site visit.
 */
export function completionSourceFor(target) {
  return target === "completed" ? "manual" : null;
}
