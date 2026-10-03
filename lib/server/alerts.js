import {
  summariseViolations,
  categoryBreakdown,
  alertTiles,
  canTransition,
  violationLabel,
  VIOLATION_STATUSES,
} from "@/lib/monitor/alerts";
import { countsFromEvents } from "@/lib/monitor/signals";
import { resolveWeights, computeRisk } from "@/lib/monitor/risk";
import { pageParams } from "./monitorClient";

/**
 * Alerts and violations.
 *
 * `device_events` is the evidence, `violations` is the queue. This module reads
 * both: the tiles come from counting events in the window, the table comes from
 * the violations that were raised from those events.
 *
 * Every statement is scoped by `company_id` as well as the filter. Device events
 * are the most sensitive material in the product — a raw `fake_gps` report is a
 * claim about a named employee — so the tenant filter is never left to RLS
 * alone.
 */

const VIOLATION_SELECT = [
  "id",
  "employee_id",
  "type",
  "category",
  "severity",
  "occurred_at",
  "status",
  "meta",
  "created_at",
  "employees ( id, emp_code, name, photo_url, department_id, departments ( id, name ) )",
].join(", ");

const EVENT_SELECT = [
  "id",
  "employee_id",
  "type",
  "severity",
  "occurred_at",
  "reported_at",
  "meta",
].join(", ");

/** Default window for the tiles: long enough to catch a device that died quietly. */
export const DEFAULT_WINDOW_DAYS = 7;

function sanitiseSearch(value) {
  return String(value || "")
    .replace(/[%_\\]/g, (c) => `\\${c}`)
    .slice(0, 120);
}

function utcWindowStart(days) {
  return new Date(Date.now() - Math.max(1, Number(days) || DEFAULT_WINDOW_DAYS) * 86400000).toISOString();
}

/** Flatten a PostgREST embedded relation, which returns an object or an array. */
function embedded(value) {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Violations for the work queue.
 *
 * Default status filter is `open` + `acknowledged` rather than everything:
 * the queue an admin opens should be what still needs doing.
 */
export async function listViolations(
  supabase,
  {
    companyId,
    windowDays = DEFAULT_WINDOW_DAYS,
    status,
    category,
    severity,
    employeeId,
    search,
    page = 1,
    pageSize = 25,
  } = {}
) {
  const { from, to: end, page: current, pageSize: size } = pageParams({ page, pageSize });

  let query = supabase
    .from("violations")
    .select(VIOLATION_SELECT, { count: "exact" })
    .eq("company_id", companyId)
    .gte("occurred_at", utcWindowStart(windowDays))
    .order("occurred_at", { ascending: false })
    .range(from, end);

  // `unresolved` is the useful default; spelled out here so the queue opens on
  // work rather than on history.
  if (!status || status === "unresolved") {
    query = query.in("status", ["open", "acknowledged"]);
  } else if (status !== "all") {
    query = query.eq("status", status);
  }

  if (category) query = query.eq("category", category);
  if (severity) query = query.eq("severity", severity);
  if (employeeId) query = query.eq("employee_id", employeeId);

  const term = sanitiseSearch(search);
  if (term) {
    query = query.or(
      `employees.name.ilike(%${term}%),employees.emp_code.ilike(%${term}%),type.ilike(%${term}%)`
    );
  }

  const { data, error } = await query;
  if (error) throw error;

  const rows = (data || []).map((row) => {
    const employee = embedded(row.employees);
    const department = embedded(employee?.departments);

    return {
      id: row.id,
      employee_id: row.employee_id,
      emp_code: employee?.emp_code || null,
      name: employee?.name || "Unknown employee",
      photo_url: employee?.photo_url || null,
      department_name: department?.name || null,
      type: row.type,
      label: violationLabel(row.type),
      category: row.category,
      severity: row.severity,
      occurred_at: row.occurred_at,
      status: row.status,
      meta: row.meta || {},
    };
  });

  return { rows, page: current, page_size: size };
}

/**
 * Move a violation along its lifecycle.
 *
 * The transition is validated here as well as in the UI, because this is the one
 * endpoint where an illegal jump (`open` straight to `resolved`) would destroy
 * the record of who ignored it.
 */
export async function updateViolationStatus(supabase, { companyId, id, status }) {
  const { data: current, error: readError } = await supabase
    .from("violations")
    .select("id, status, employee_id, type, severity, occurred_at")
    .eq("company_id", companyId)
    .eq("id", id)
    .maybeSingle();

  if (readError) throw readError;
  if (!current) return { error: "not_found" };

  if (!VIOLATION_STATUSES.includes(status)) {
    return { error: "invalid_status" };
  }

  if (!canTransition(current.status, status)) {
    return { error: "invalid_transition", from: current.status, to: status };
  }

  const { data, error } = await supabase
    .from("violations")
    .update({ status })
    .eq("company_id", companyId)
    .eq("id", id)
    // Re-assert the starting status so two admins acting at once cannot both
    // win the same transition.
    .eq("status", current.status)
    .select("id, status, employee_id, type, severity, occurred_at")
    .maybeSingle();

  if (error) throw error;
  if (!data) return { error: "conflict" };

  return { violation: data };
}

/**
 * Raw device events — the evidence behind a violation.
 *
 * Deliberately a separate endpoint from the violations list: this is the
 * unfiltered event log for the window, not the curated queue.
 */
export async function listDeviceEvents(
  supabase,
  { companyId, windowDays = DEFAULT_WINDOW_DAYS, employeeId, type, severity, search, limit = 100 } = {}
) {
  let query = supabase
    .from("device_events")
    .select(
      `${EVENT_SELECT}, employees ( id, emp_code, name, photo_url, departments ( id, name ) )`,
      { count: "exact" }
    )
    .eq("company_id", companyId)
    .gte("occurred_at", utcWindowStart(windowDays))
    .order("occurred_at", { ascending: false })
    .limit(Math.min(Math.max(1, Number(limit) || 100), 500));

  if (employeeId) query = query.eq("employee_id", employeeId);
  if (type) query = query.eq("type", type);
  if (severity) query = query.eq("severity", severity);

  const term = sanitiseSearch(search);
  if (term) {
    query = query.or(`employees.name.ilike(%${term}%),employees.emp_code.ilike(%${term}%)`);
  }

  const { data, error } = await query;
  if (error) throw error;

  const rows = (data || []).map((row) => {
    const employee = embedded(row.employees);
    return {
      id: row.id,
      employee_id: row.employee_id,
      emp_code: employee?.emp_code || null,
      name: employee?.name || "Unknown employee",
      photo_url: employee?.photo_url || null,
      department_name: embedded(employee?.departments)?.name || null,
      type: row.type,
      severity: row.severity,
      occurred_at: row.occurred_at,
      reported_at: row.reported_at,
      // A gap between the two is itself an integrity signal, so the delta is
      // computed here rather than left for the reader to subtract.
      delivery_delay_seconds:
        row.reported_at && row.occurred_at
          ? Math.round((new Date(row.reported_at) - new Date(row.occurred_at)) / 1000)
          : null,
      meta: row.meta || {},
    };
  });

  return { rows, total: data?.length || 0 };
}

/**
 * Everything the alerts screen needs.
 *
 * The tiles count *events* in the window while the table lists *violations*
 * raised from them, so the two numbers are not expected to match: one phone
 * reporting the same fault hourly is one violation and many events. Labelling
 * them differently is what stops that reading as a bug.
 */
export async function alertsOverview(
  supabase,
  { companyId, windowDays = DEFAULT_WINDOW_DAYS, settings = {} } = {}
) {
  const since = utcWindowStart(windowDays);

  const { data: events, error: eventError } = await supabase
    .from("device_events")
    .select(EVENT_SELECT)
    .eq("company_id", companyId)
    .gte("occurred_at", since)
    .order("occurred_at", { ascending: false })
    .limit(5000);

  if (eventError) throw eventError;

  const { data: violations, error: violationError } = await supabase
    .from("violations")
    .select("id, employee_id, type, category, severity, status, occurred_at")
    .eq("company_id", companyId)
    .gte("occurred_at", since);

  if (violationError) throw violationError;

  const weights = resolveWeights(settings);

  // Per-employee counts across the whole window, so the risk strip reflects
  // everything rather than just the page of violations on screen.
  const byEmployee = {};
  for (const ev of events || []) {
    const counts = countsFromEvents([ev]);
    byEmployee[ev.employee_id] = { ...(byEmployee[ev.employee_id] || {}), ...counts };
  }

  const flaggedIds = Object.entries(byEmployee)
    .map(([employeeId, counts]) => ({ employee_id: employeeId, ...computeRisk(counts, weights) }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);

  // Names are resolved here rather than in the UI: this list spans the whole
  // window, while the queue beside it is paginated and filtered, so joining the
  // two would leave most rows showing a bare UUID.
  let flagged = flaggedIds;
  if (flaggedIds.length) {
    const { data: people } = await supabase
      .from("employees")
      .select("id, emp_code, name, photo_url, department_id, departments ( id, name )")
      .eq("company_id", companyId)
      .in(
        "id",
        flaggedIds.map((row) => row.employee_id)
      );

    const byId = new Map((people || []).map((p) => [p.id, p]));
    flagged = flaggedIds.map((row) => {
      const person = byId.get(row.employee_id);
      const department = embedded(person?.departments);
      return {
        ...row,
        emp_code: person?.emp_code || null,
        name: person?.name || "Unknown employee",
        photo_url: person?.photo_url || null,
        department_name: department?.name || null,
      };
    });
  }

  return {
    window_days: windowDays,
    since,
    tiles: alertTiles(countsFromEvents(events || [])),
    summary: summariseViolations(violations || []),
    categories: categoryBreakdown(violations || []),
    flagged,
    event_total: (events || []).length,
    violation_total: (violations || []).length,
  };
}