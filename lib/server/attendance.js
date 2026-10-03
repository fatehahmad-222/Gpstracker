import {
  deriveDay,
  summariseDay,
  departmentAttendance,
  attendanceChips,
  weeklyTrend,
  matchesStatusFilter,
} from "@/lib/monitor/attendance";
import { companyDayRange, toCompanyDate, addDays, DEFAULT_TZ } from "@/lib/monitor/datetime";
import { pageParams } from "./monitorClient";

/**
 * Attendance persistence.
 *
 * Two tables with very different jobs:
 *   `attendance_sessions` — the raw punch log. Appended as the phone reports,
 *                           and the only thing a manager disputes.
 *   `attendance_daily`    — the derived rollup, written solely by the scheduled
 *                           SQL job (`recompute_attendance_daily`).
 *
 * The list below derives live from the sessions rather than reading
 * `attendance_daily`, because a scheduled rollup is always behind: an admin
 * asking "who is in right now" must not be answered from yesterday's snapshot.
 * `deriveDay` is the tested JS mirror of that SQL, so the page and the report
 * agree. The persisted rollup is still written, via `recomputeDaily`, because
 * payroll and exports read it.
 */

const EMPLOYEE_SELECT = [
  "id",
  "emp_code",
  "name",
  "phone",
  "photo_url",
  "department_id",
  "designation_id",
  "shift_start",
  "shift_end",
  "status",
  "deleted_at",
  "attendance_source",
  "geofencing_enabled",
  "departments ( id, name )",
].join(", ");

const SESSION_SELECT = [
  "id",
  "employee_id",
  "clock_in_at",
  "clock_out_at",
  "clock_in_lat",
  "clock_in_lng",
  "clock_out_lat",
  "clock_out_lng",
  "geofence_id",
  "out_reason",
  "source",
].join(", ");

/**
 * `status` is a computed value rather than a column, so the filter cannot run
 * in SQL. `matchesStatusFilter` lives in the pure layer; it is re-exported here
 * so callers already importing this module keep one import site.
 */
export { matchesStatusFilter };

/** Escape the LIKE metacharacters a search box can smuggle in. */
function sanitiseSearch(value) {
  return String(value || "")
    .replace(/[%_\\]/g, (c) => `\\${c}`)
    .slice(0, 120);
}

/**
 * Attendance rows for one company-local calendar day.
 *
 * Archived employees are included rather than hidden: "they did not clock in"
 * is exactly what a manager needs to see about someone who left last month.
 */
export async function listAttendance(
  supabase,
  { companyId, date, departmentId, status, search, includeArchived = false } = {}
) {
  const day = date || toCompanyDate(new Date(), DEFAULT_TZ);
  const { from, to } = companyDayRange(day, DEFAULT_TZ);

  let employeeQuery = supabase
    .from("employees")
    .select(EMPLOYEE_SELECT)
    .eq("company_id", companyId)
    .eq("status", "active");

  if (!includeArchived) employeeQuery = employeeQuery.is("deleted_at", null);
  if (departmentId) employeeQuery = employeeQuery.eq("department_id", departmentId);

  const term = sanitiseSearch(search);
  if (term) {
    employeeQuery = employeeQuery.or(
      `name.ilike(%${term}%),emp_code.ilike(%${term}%),phone.ilike(%${term}%)`
    );
  }

  const { data: employees, error: employeeError } = await employeeQuery;
  if (employeeError) throw employeeError;
  if (!employees?.length) return { date: day, rows: [] };

  const ids = employees.map((e) => e.id);

  const { data: sessions, error: sessionError } = await supabase
    .from("attendance_sessions")
    .select(SESSION_SELECT)
    .in("employee_id", ids)
    // A session that opened yesterday and closes today still belongs to today,
    // so the window is bounded by clock-in only.
    .lt("clock_in_at", to)
    .order("clock_in_at", { ascending: true });

  if (sessionError) throw sessionError;

  const byEmployee = new Map();
  for (const session of sessions || []) {
    if (!byEmployee.has(session.employee_id)) byEmployee.set(session.employee_id, []);
    byEmployee.get(session.employee_id).push(session);
  }

  const now = new Date();
  let rows = employees.map((employee) => {
    const department = Array.isArray(employee.departments)
      ? employee.departments[0]
      : employee.departments;

    const derived = deriveDay({
      employee,
      sessions: byEmployee.get(employee.id) || [],
      now,
      tz: DEFAULT_TZ,
    });

    const own = byEmployee.get(employee.id) || [];

    return {
      employee_id: employee.id,
      emp_code: employee.emp_code,
      name: employee.name,
      phone: employee.phone,
      photo_url: employee.photo_url,
      department_id: employee.department_id,
      department_name: department?.name || null,
      shift_start: employee.shift_start,
      shift_end: employee.shift_end,
      archived: Boolean(employee.deleted_at),
      session_count: own.length,
      open_session_id: own.find((s) => !s.clock_out_at)?.id || null,
      ...derived,
    };
  });

  // Filtering happens after derivation on purpose: `status` is a computed
  // value, not a column, so a SQL-side filter could not see it.
  if (status) rows = rows.filter((row) => matchesStatusFilter(row, status));

  return { date: day, rows };
}

/**
 * Everything the attendance page needs, in one response.
 *
 * `rows` is filtered for the table; `summary`, `chips` and `departments` are
 * always computed from the whole day. A header that recounted itself every time
 * a filter chip was clicked would be useless — the counts have to stay pinned to
 * the day so the chips can be read as "of everyone, how many".
 */
export async function attendanceOverview(
  supabase,
  { companyId, date, departmentId, status, search, includeArchived = false } = {}
) {
  const { date: day, rows: everyone } = await listAttendance(supabase, {
    companyId,
    date,
    departmentId,
    search,
    includeArchived,
  });

  const rows = everyone.filter((row) => matchesStatusFilter(row, status));

  return {
    date: day,
    rows,
    total: everyone.length,
    filtered: rows.length,
    summary: summariseDay(everyone),
    chips: attendanceChips(everyone),
    departments: departmentAttendance(everyone),
  };
}

/**
 * The raw punch log, paginated.
 *
 * This is the auditable view: one row per clock-in, whatever the derived day
 * says. Disputes are settled here.
 */
export async function listSessionLog(
  supabase,
  {
    companyId,
    date,
    departmentId,
    employeeId,
    outReason,
    open,
    search,
    page = 1,
    pageSize = 25,
  } = {}
) {
  const day = date || toCompanyDate(new Date(), DEFAULT_TZ);
  const { from, to } = companyDayRange(day, DEFAULT_TZ);
  const { from: offset, to: offsetEnd, page: current, pageSize: size } = pageParams({ page, pageSize });

  let query = supabase
    .from("attendance_sessions")
    .select(`${SESSION_SELECT}, employees ( id, emp_code, name, department_id, departments ( id, name ) )`, {
      count: "exact",
    })
    .eq("company_id", companyId)
    .gte("clock_in_at", from)
    .lt("clock_in_at", to)
    .order("clock_in_at", { ascending: false })
    .range(offset, offsetEnd);

  if (employeeId) query = query.eq("employee_id", employeeId);
  if (outReason) query = query.eq("out_reason", outReason);
  if (open === true) query = query.is("clock_out_at", null);
  if (open === false) query = query.not("clock_out_at", "is", null);
  if (departmentId) query = query.eq("employees.department_id", departmentId);

  const term = sanitiseSearch(search);
  if (term) query = query.or(`employees.name.ilike(%${term}%),employees.emp_code.ilike(%${term}%)`);

  const { data, error } = await query;
  if (error) throw error;

  const rows = (data || []).map((row) => {
    const employee = Array.isArray(row.employees) ? row.employees[0] : row.employees;
    const department = employee?.departments
      ? Array.isArray(employee.departments)
        ? employee.departments[0]
        : employee.departments
      : null;

    return {
      id: row.id,
      employee_id: row.employee_id,
      emp_code: employee?.emp_code || null,
      name: employee?.name || "Unknown employee",
      department_name: department?.name || null,
      clock_in_at: row.clock_in_at,
      clock_out_at: row.clock_out_at,
      clock_in_lat: row.clock_in_lat,
      clock_in_lng: row.clock_in_lng,
      clock_out_lat: row.clock_out_lat,
      clock_out_lng: row.clock_out_lng,
      geofence_id: row.geofence_id,
      out_reason: row.out_reason,
      source: row.source,
      stay_seconds: row.clock_out_at
        ? Math.max(
            0,
            Math.round((new Date(row.clock_out_at) - new Date(row.clock_in_at)) / 1000)
          )
        : 0,
      open: !row.clock_out_at,
    };
  });

  return { date: day, rows, page: current, page_size: size };
}

/** Seven days of rollups for the attendance trend strip. */
export async function attendanceTrend(supabase, { companyId, endDate } = {}) {
  const end = endDate || toCompanyDate(new Date(), DEFAULT_TZ);
  const start = addDays(end, -6);

  const { data, error } = await supabase
    .from("attendance_daily")
    .select("date, status, punctuality, early_exit, overtime_seconds")
    .eq("company_id", companyId)
    .gte("date", start)
    .lte("date", end)
    .order("date", { ascending: true });

  if (error) throw error;

  // `weeklyTrend` buckets by company-local date, so anchor it midday UTC to
  // keep it on the requested day in either direction of UTC offset.
  return {
    start,
    end,
    days: weeklyTrend(data || [], new Date(`${end}T12:00:00Z`), DEFAULT_TZ),
  };
}

/**
 * One open session, for the manual clock-out confirmation.
 *
 * Read before writing so an impossible timestamp can be rejected *before* the
 * row changes — a session cannot end before it began, and a negative duration
 * would corrupt every downstream rollup.
 */
export async function findOpenSession(supabase, { companyId, sessionId }) {
  const { data, error } = await supabase
    .from("attendance_sessions")
    .select("id, employee_id, company_id, clock_in_at, clock_out_at, out_reason, source, employees ( id, emp_code, name )")
    .eq("company_id", companyId)
    .eq("id", sessionId)
    .is("clock_out_at", null)
    .maybeSingle();

  if (error) throw error;
  return data;
}

/**
 * An administrator closing an open session by hand.
 *
 * Restricted to sessions that are actually still open: re-closing a finished
 * session would silently rewrite worked hours, which is a payroll change and
 * belongs in a different flow.
 */
export async function closeSessionManually(supabase, { companyId, sessionId, clockOutAt }) {
  const { data, error } = await supabase
    .from("attendance_sessions")
    .update({ clock_out_at: clockOutAt, out_reason: "admin" })
    .eq("company_id", companyId)
    .eq("id", sessionId)
    // Re-asserting this in the WHERE clause makes the close idempotent under a
    // double submit: the second attempt simply matches nothing.
    .is("clock_out_at", null)
    .select("id, employee_id, clock_in_at, clock_out_at, out_reason")
    .maybeSingle();

  if (error) throw error;
  return data;
}

/** Who is still clocked in right now, across the whole company. */
export async function listOpenSessions(supabase, { companyId } = {}) {
  const { data, error } = await supabase
    .from("attendance_sessions")
    .select("id, employee_id, clock_in_at, employees ( id, emp_code, name, departments ( id, name ) )")
    .eq("company_id", companyId)
    .is("clock_out_at", null)
    .order("clock_in_at", { ascending: true });

  if (error) throw error;

  return (data || []).map((row) => {
    const employee = Array.isArray(row.employees) ? row.employees[0] : row.employees;
    const department = employee?.departments
      ? Array.isArray(employee.departments)
        ? employee.departments[0]
        : employee.departments
      : null;

    return {
      id: row.id,
      employee_id: row.employee_id,
      emp_code: employee?.emp_code || null,
      name: employee?.name || "Unknown employee",
      department_name: department?.name || null,
      clock_in_at: row.clock_in_at,
      age_seconds: Math.max(0, Math.round((Date.now() - new Date(row.clock_in_at)) / 1000)),
    };
  });
}