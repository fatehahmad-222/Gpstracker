import { buildDashboard } from "@/lib/monitor/dashboard";
import { deriveDay } from "@/lib/monitor/attendance";
import { toCompanyDate, companyDayRange, DEFAULT_TZ } from "@/lib/monitor/datetime";
import { listOpenSessions } from "./attendance";

/**
 * Dashboard data access.
 *
 * Aggregates several tables in one request because the page needs all of them at
 * once; eight round trips to render eight cards would be a worse experience
 * than one slightly larger payload.
 *
 * Every query is scoped by `company_id`. The dashboard reads the most sensitive
 * material in the product — device state and accusations about named employees —
 * so the tenant filter is never left to RLS alone.
 */

const DEFAULT_WINDOW_DAYS = 7;

/** Per-employee fields the card set needs, and nothing more. */
const EMPLOYEE_SELECT = [
  "id",
  "emp_code",
  "name",
  "department_id",
  "shift_start",
  "shift_end",
  "status",
  "deleted_at",
  "geofencing_enabled",
  "departments ( id, name )",
].join(", ");

const SESSION_SELECT = ["id", "employee_id", "clock_in_at", "clock_out_at", "out_reason"].join(", ");

function embedded(value) {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * One request's worth of dashboard data.
 *
 * `days` is derived live from sessions rather than read from `attendance_daily`,
 * for the same reason the attendance page does it: the persisted rollup is
 * written by a scheduled job and is therefore always slightly behind, and
 * "present now" is the one figure that cannot afford to be.
 */
export async function dashboardOverview(
  supabase,
  { companyId, date, timezone = DEFAULT_TZ, windowDays = DEFAULT_WINDOW_DAYS, settings = {} } = {}
) {
  const tz = timezone || DEFAULT_TZ;
  const day = date || toCompanyDate(new Date(), tz);
  const { to } = companyDayRange(day, tz);
  const windowStart = new Date(Date.now() - windowDays * 86400000).toISOString();

  const [employeesResult, violationsResult, eventsResult, leavesResult, devicesResult] =
    await Promise.all([
      supabase
        .from("employees")
        .select(EMPLOYEE_SELECT)
        .eq("company_id", companyId)
        .eq("status", "active")
        .is("deleted_at", null),
      supabase
        .from("violations")
        .select("id, employee_id, type, category, severity, status, occurred_at")
        .eq("company_id", companyId)
        .gte("occurred_at", windowStart)
        .order("occurred_at", { ascending: false })
        .limit(2000),
      supabase
        .from("device_events")
        .select("employee_id, type, severity, occurred_at")
        .eq("company_id", companyId)
        .gte("occurred_at", windowStart)
        .limit(5000),
      supabase
        .from("leaves")
        .select("id, employee_id, status, from_date, to_date")
        .eq("company_id", companyId)
        .limit(1000),
      supabase
        .from("device_profiles")
        .select("employee_id, status, last_seen_at")
        .eq("company_id", companyId),
    ]);

  // Any one of these failing means the card set would be quietly wrong, so the
  // error is surfaced rather than rendered as a zero.
  for (const [name, result] of [
    ["employees", employeesResult],
    ["violations", violationsResult],
    ["device_events", eventsResult],
    ["leaves", leavesResult],
    ["device_profiles", devicesResult],
  ]) {
    if (result.error) throw Object.assign(result.error, { table: name });
  }

  const employees = employeesResult.data || [];
  const ids = employees.map((e) => e.id);

  const sessionsResult = ids.length
    ? await supabase
        .from("attendance_sessions")
        .select(SESSION_SELECT)
        .in("employee_id", ids)
        // Bounded by clock-in only, deliberately: a session that opened before
        // midnight and closes today still belongs to today, so a lower bound
        // here would silently mark those employees absent.
        .lt("clock_in_at", to)
        .order("clock_in_at", { ascending: true })
    : { data: [], error: null };

  if (sessionsResult.error) throw sessionsResult.error;

  const sessionsByEmployee = new Map();
  for (const session of sessionsResult.data || []) {
    const bucket = sessionsByEmployee.get(session.employee_id);
    if (bucket) bucket.push(session);
    else sessionsByEmployee.set(session.employee_id, [session]);
  }

  const now = new Date();
  const days = employees.map((employee) => {
    const department = embedded(employee.departments);
    return {
      employee_id: employee.id,
      name: employee.name,
      department_name: department?.name || null,
      ...deriveDay({
        employee,
        sessions: sessionsByEmployee.get(employee.id) || [],
        now,
        tz,
      }),
    };
  });

  // Names for the risk board, which spans every employee with a signal in the
  // window and so cannot be resolved from the paginated table beside it.
  const people = new Map(
    employees.map((e) => [
      e.id,
      {
        emp_code: e.emp_code,
        name: e.name,
        department_name: embedded(e.departments)?.name || null,
      },
    ])
  );

  const openSessions = await listOpenSessions(supabase, { companyId });

  return buildDashboard({
    date: day,
    days,
    violations: violationsResult.data || [],
    events: eventsResult.data || [],
    leaves: leavesResult.data || [],
    devices: devicesResult.data || [],
    openSessions,
    people,
    settings,
    now,
  });
}