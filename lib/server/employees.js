import { generateAppPassword, hashAppPassword } from "@/lib/monitor/password";
import { toEmployeeRow } from "@/lib/monitor/employee-mapper";

/**
 * Employee CRUD for the monitor module (spec 5).
 *
 * The `employees` table has far more columns than the form shows, and several of
 * them store a different representation from the one the user types (shift times
 * are minutes-from-midnight in the column, "HH:MM" in the form; the phone is
 * `phone`, not `contact_no`). All of that translation lives here so the route
 * handlers stay thin and the mapping is testable without a database.
 */

export const EMPLOYEE_SELECT = [
  "id",
  "emp_code",
  "name",
  "father_husband_name",
  "dob",
  "gender",
  "marital_status",
  "cnic",
  "phone",
  "email",
  "address",
  "hire_date",
  "education",
  "department_id",
  "designation_id",
  "last_job_history",
  "shift_start",
  "shift_end",
  "basic_salary",
  "payment_method",
  "late_deduction",
  "overnight_allowed",
  "absent_deduction",
  "wht_tax",
  "geofencing_enabled",
  "attendance_source",
  "photo_url",
  "tracking_consent",
  "status",
  "deleted_at",
  "created_at",
].join(", ");

/** Fields the list screen never needs; the app password hash must not leak. */
export const EMPLOYEE_SUMMARY_SELECT = [
  "id",
  "emp_code",
  "name",
  "phone",
  "email",
  "department_id",
  "designation_id",
  "shift_start",
  "shift_end",
  "basic_salary",
  "geofencing_enabled",
  "attendance_source",
  "status",
  "deleted_at",
  "created_at",
].join(", ");

function minutesFromMidnight(value) {
  const match = /^(\d{1,2}):([0-5]\d)$/.exec(String(value || ""));
  if (!match) return null;
  const minutes = Number(match[1]) * 60 + Number(match[2]);
  return minutes >= 0 && minutes <= 1439 ? minutes : null;
}

function midnightToTime(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Strip the columns a client must never be able to set directly. */
const CLIENT_CONTROLLED = new Set(["id", "company_id", "profile_id", "deleted_at", "created_at"]);

function sanitiseRow(row) {
  const clean = { ...row };
  for (const key of CLIENT_CONTROLLED) delete clean[key];
  return clean;
}

/**
 * Create an employee plus their geofence assignments.
 *
 * The app password is hashed here, at the only place the plaintext exists, and
 * only the hash reaches the database.
 *
 * The two writes are not in a transaction (PostgREST has no multi-statement
 * transaction), so the geofence insert is best-effort and reports how many were
 * linked; the employee row itself is the record that must succeed.
 */
export async function createEmployee(supabase, { companyId, values, appPassword }) {
  const row = sanitiseRow(toEmployeeRow(values));

  // Every employee needs a password they can sign in to the tracker app with, so
  // a missing one is generated here rather than accepted. The plaintext is
  // returned exactly once, for the caller to hand over.
  const generated = appPassword ? null : generateAppPassword();
  row.app_password_hash = hashAppPassword(appPassword || generated);

  const { data, error } = await supabase
    .from("employees")
    .insert({ ...row, company_id: companyId })
    .select(EMPLOYEE_SELECT)
    .single();

  if (error) throw error;

  const linked = await syncGeofences(supabase, {
    companyId,
    employeeId: data.id,
    geofenceIds: values.geofence_ids || [],
  });

  return { employee: data, geofencesLinked: linked, generatedPassword: generated };
}

/** Patch an employee. Omitted fields are left untouched. */
export async function updateEmployee(supabase, { companyId, id, values, geofenceIds, appPassword }) {
  const row = sanitiseRow(toEmployeeRow(values));
  if (appPassword) row.app_password_hash = hashAppPassword(appPassword);

  const { data, error } = await supabase
    .from("employees")
    .update(row)
    .eq("id", id)
    .eq("company_id", companyId)
    .select(EMPLOYEE_SELECT)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  if (Array.isArray(geofenceIds)) {
    await syncGeofences(supabase, { companyId, employeeId: id, geofenceIds });
  }

  return data;
}

/**
 * Replace an employee's geofence assignments.
 *
 * `delete().neq()` rather than `delete()` alone: PostgREST needs a filter to
 * target the employee's rows instead of erroring on the whole table.
 */
export async function syncGeofences(supabase, { companyId, employeeId, geofenceIds }) {
  const { error: clearError } = await supabase
    .from("employee_geofences")
    .delete()
    .eq("employee_id", employeeId)
    .eq("company_id", companyId)
    .neq("employee_id", null);

  if (clearError) throw clearError;

  const ids = [...new Set(geofenceIds.filter(Boolean))];
  if (!ids.length) return 0;

  const { error } = await supabase
    .from("employee_geofences")
    .insert(ids.map((geofenceId) => ({ company_id: companyId, employee_id: employeeId, geofence_id: geofenceId })));

  if (error) throw error;
  return ids.length;
}

export async function listEmployeeGeofences(supabase, { companyId, employeeId }) {
  const { data, error } = await supabase
    .from("employee_geofences")
    .select("geofence_id")
    .eq("company_id", companyId)
    .eq("employee_id", employeeId);

  if (error) throw error;
  return (data || []).map((r) => r.geofence_id);
}

/**
 * Soft-delete an employee.
 *
 * Attendance history, sessions and events all reference `employees`, so the row
 * is never removed — it is hidden from pickers and kept for reporting.
 */
export async function archiveEmployee(supabase, { companyId, id, deleted }) {
  const { data, error } = await supabase
    .from("employees")
    .update({ deleted_at: deleted ? new Date().toISOString() : null, status: "inactive" })
    .eq("id", id)
    .eq("company_id", companyId)
    .select("id, name, emp_code, status, deleted_at")
    .maybeSingle();

  if (error) throw error;
  return data;
}

/** Set or reset the tracker app password. The plaintext is never stored. */
export async function setAppPassword(supabase, { companyId, id, password }) {
  const { data, error } = await supabase
    .from("employees")
    .update({ app_password_hash: hashAppPassword(password) })
    .eq("id", id)
    .eq("company_id", companyId)
    .select("id, name, emp_code")
    .maybeSingle();

  if (error) throw error;
  return data;
}

/**
 * Search employees for the list screen.
 *
 * Archived employees are excluded unless explicitly requested, and the free-text
 * term is sanitised before it reaches a PostgREST `or()` filter.
 */
export async function listEmployees(supabase, {
  companyId,
  departmentId,
  designationId,
  status,
  search,
  geofencing,
  includeArchived = false,
  from,
  to,
  count = "exact",
}) {
  let query = supabase
    .from("employees")
    .select(EMPLOYEE_SUMMARY_SELECT, { count })
    .eq("company_id", companyId);

  if (!includeArchived) query = query.is("deleted_at", null);
  if (departmentId) query = query.eq("department_id", departmentId);
  if (designationId) query = query.eq("designation_id", designationId);
  if (status === "active" || status === "inactive") query = query.eq("status", status);
  if (geofencing === "on") query = query.eq("geofencing_enabled", true);
  if (geofencing === "off") query = query.eq("geofencing_enabled", false);
  if (search) {
    const term = `"${String(search).replace(/["\\%,()]/g, " ")}"`;
    query = query.or(`name.ilike.%${term}%,emp_code.ilike.%${term}%,phone.ilike.%${term}%`);
  }

  const { data, error, count: total } = await query
    .order("name", { ascending: true })
    .range(from, to);

  if (error) throw error;
  return { rows: data || [], total: total ?? (data || []).length };
}

/** Resolve department / designation / geofence names for the list view. */
export async function withEmployeeLabels(supabase, { companyId, rows }) {
  const ids = (key) => [...new Set(rows.map((r) => r[key]).filter(Boolean))];

  const [departments, designations] = await Promise.all([
    ids("department_id").length
      ? supabase.from("departments").select("id, name").in("id", ids("department_id")).eq("company_id", companyId)
      : Promise.resolve({ data: [] }),
    ids("designation_id").length
      ? supabase.from("designations").select("id, name").in("id", ids("designation_id")).eq("company_id", companyId)
      : Promise.resolve({ data: [] }),
  ]);

  const deptNames = Object.fromEntries((departments.data || []).map((d) => [d.id, d.name]));
  const titleNames = Object.fromEntries((designations.data || []).map((d) => [d.id, d.name]));

  return rows.map((row) => ({
    ...row,
    department_name: deptNames[row.department_id] || null,
    designation_name: titleNames[row.designation_id] || null,
    shift_label: `${midnightToTime(row.shift_start)}–${midnightToTime(row.shift_end)}`,
    is_archived: Boolean(row.deleted_at),
  }));
}

export { midnightToTime };