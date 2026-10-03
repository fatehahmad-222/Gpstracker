/**
 * Leave request rules.
 *
 * Kept out of the routes and the component so the parts that are easy to get
 * wrong - the state machine, the date window, and what counts as a duplicate -
 * can be tested directly rather than through a form.
 */

export const LEAVE_TYPES = ["casual", "sick", "annual"];

export const LEAVE_STATUSES = ["pending", "approved", "rejected"];

/** Pill tone per status. Pending is the only state anyone can still act on. */
export const LEAVE_STATUS_META = {
  pending: { label: "Pending", status: "warn" },
  approved: { label: "Approved", status: "ok" },
  rejected: { label: "Rejected", status: "danger" },
};

export const MAX_REASON_LENGTH = 500;

function isIsoDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/**
 * Validate and normalise a leave request.
 *
 * Returns `{ errors, value }` rather than throwing, because the caller wants to
 * show every problem against the field that caused it rather than the first one.
 * `value` is null when anything was wrong, so a partial request is never stored.
 */
export function validateLeaveRequest(input = {}) {
  const errors = {};

  const employeeId = typeof input.employee_id === "string" ? input.employee_id.trim() : "";
  if (!employeeId) errors.employee_id = "Choose an employee";

  const leaveType = LEAVE_TYPES.includes(input.leave_type) ? input.leave_type : "casual";

  const fromDate = isIsoDate(input.from_date) ? input.from_date : "";
  if (!fromDate) errors.from_date = "Start date is required";

  const toDate = isIsoDate(input.to_date) ? input.to_date : "";
  if (!toDate) errors.to_date = "End date is required";

  // Compared as strings, which is valid because both are zero-padded ISO dates.
  // Doing this on Date objects invites a timezone shift to move the boundary by a
  // day for someone in UTC+5.
  if (fromDate && toDate && toDate < fromDate) {
    errors.to_date = "End date cannot be before the start date";
  }

  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  if (reason.length > MAX_REASON_LENGTH) {
    errors.reason = `Reason must be ${MAX_REASON_LENGTH} characters or fewer`;
  }

  const days = fromDate && toDate ? countDays(fromDate, toDate) : 0;

  return {
    errors,
    value: Object.keys(errors).length === 0
      ? { employee_id: employeeId, leave_type: leaveType, from_date: fromDate, to_date: toDate, reason: reason || null, days }
      : null,
  };
}

/** Inclusive day count, so a one-day leave is 1 and not 0. */
export function countDays(fromDate, toDate) {
  if (!isIsoDate(fromDate) || !isIsoDate(toDate)) return 0;
  const ms = Date.parse(`${toDate}T00:00:00Z`) - Date.parse(`${fromDate}T00:00:00Z`);
  if (Number.isNaN(ms)) return 0;
  return Math.floor(ms / 86_400_000) + 1;
}

/**
 * Does this request cover any day another request already covers?
 *
 * Used to warn, not to block: overlapping requests are common and legitimate
 * when a first one is rejected, and refusing to let anyone correct a mistake is
 * worse than showing the overlap. Only decided requests are compared against, so
 * a pending duplicate still shows the overlap.
 */
export function overlapsExisting(request, existing = []) {
  if (!request?.from_date || !request?.to_date) return false;

  return existing.some((row) => {
    if (!row?.from_date || !row?.to_date) return false;
    if (row.status === "rejected") return false;
    return row.from_date <= request.to_date && row.to_date >= request.from_date;
  });
}

/**
 * Can this request still be approved or rejected?
 *
 * Only pending requests are decidable. Without this, approving an approved leave
 * would still report success while changing nothing.
 */
export function canDecide(status) {
  return status === "pending";
}

/**
 * The status a decision produces.
 *
 * `approve` and `reject` are the only transitions. There is no "undo": reversing
 * a rejection is a new request, so the audit trail reads in one direction.
 */
export function nextStatus(current, action) {
  if (!canDecide(current)) return null;
  if (action === "approve") return "approved";
  if (action === "reject") return "rejected";
  return null;
}

/** Client-side filter for the status tabs. `all` means no filter. */
export function matchesStatusFilter(row, filter) {
  if (!filter || filter === "all") return true;
  return row?.status === filter;
}

/** Newest first, with decided requests sorted after pending ones. */
export function sortLeaves(rows = []) {
  return [...rows].sort((a, b) => {
    const pa = canDecide(a.status) ? 0 : 1;
    const pb = canDecide(b.status) ? 0 : 1;
    if (pa !== pb) return pa - pb;
    if (a.from_date !== b.from_date) return b.from_date.localeCompare(a.from_date);
    return String(a.id).localeCompare(String(b.id));
  });
}