import { normalizeCnic, normalizePhone } from "./validation";

/**
 * Mapping between the employee form and the `employees` table.
 *
 * This lives outside `lib/server/` on purpose: it is pure data conversion with
 * no database or Node-only dependency, and the client form needs the row ->
 * form direction. Keeping it here means the form and the API routes cannot
 * disagree about how a shift time or a phone number is represented.
 *
 * Column differences worth knowing:
 * - the form says "HH:MM", the column stores minutes-from-midnight (1290 = 21:30)
 * - the form's `contact_no` is the column's `phone`
 * - `overnight_approved` is a form-only field, stored as `overnight_allowed`
 */

export function minutesFromMidnight(value) {
  const match = /^(\d{1,2}):([0-5]\d)$/.exec(String(value || ""));
  if (!match) return null;
  const minutes = Number(match[1]) * 60 + Number(match[2]);
  return minutes >= 0 && minutes <= 1439 ? minutes : null;
}

export function midnightToTime(minutes) {
  const safe = Number(minutes);
  if (!Number.isFinite(safe)) return "09:00";
  const h = Math.floor(safe / 60);
  const m = safe % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** A shift that ends at or before its start is an overnight shift. */
export function isOvernight(startMin, endMin) {
  return Number(endMin) <= Number(startMin);
}

/** Map validated form values onto `employees` columns. */
export function toEmployeeRow(values) {
  const start = minutesFromMidnight(values.shift_start);
  const end = minutesFromMidnight(values.shift_end);

  return {
    emp_code: values.emp_code,
    name: values.name,
    father_husband_name: values.father_husband_name || null,
    dob: values.dob || null,
    gender: values.gender,
    marital_status: values.marital_status || null,
    cnic: values.cnic ? normalizeCnic(values.cnic) : null,
    phone: values.contact_no ? normalizePhone(values.contact_no) : null,
    email: values.email || null,
    address: values.address || null,
    hire_date: values.hire_date,
    education: values.education || null,
    department_id: values.department_id,
    designation_id: values.designation_id,
    last_job_history: values.last_job_history || null,
    shift_start: start,
    shift_end: end,
    overnight_allowed: Boolean(values.overnight_approved) || isOvernight(start, end),
    basic_salary: values.basic_salary,
    payment_method: values.payment_method || null,
    late_deduction: Boolean(values.late_deduction),
    overtime_allowed: Boolean(values.overtime_allowed),
    absent_deduction: Boolean(values.absent_deduction),
    wht_tax: Boolean(values.wht_tax),
    geofencing_enabled: Boolean(values.geofencing_enabled),
    attendance_source: values.attendance_source || "GPS APP",
    photo_url: values.photo_url || null,
    tracking_consent: Boolean(values.tracking_consent),
  };
}

/** Inverse of `toEmployeeRow`, used to fill the edit form. */
export function fromEmployeeRow(row, { geofenceIds = [] } = {}) {
  return {
    emp_code: row.emp_code ?? "",
    name: row.name ?? "",
    father_husband_name: row.father_husband_name ?? "",
    dob: row.dob ?? "",
    gender: row.gender ?? "male",
    marital_status: row.marital_status ?? "",
    cnic: row.cnic ?? "",
    contact_no: row.phone ?? "",
    email: row.email ?? "",
    address: row.address ?? "",
    hire_date: row.hire_date ?? "",
    education: row.education ?? "",
    department_id: row.department_id ?? "",
    designation_id: row.designation_id ?? "",
    last_job_history: row.last_job_history ?? "",
    shift_start: midnightToTime(row.shift_start ?? 540),
    shift_end: midnightToTime(row.shift_end ?? 1020),
    overnight_approved: Boolean(row.overnight_allowed),
    basic_salary: Number(row.basic_salary ?? 0),
    payment_method: row.payment_method ?? "",
    late_deduction: Boolean(row.late_deduction),
    overtime_allowed: row.overtime_allowed !== false,
    absent_deduction: Boolean(row.absent_deduction),
    wht_tax: Boolean(row.wht_tax),
    geofencing_enabled: row.geofencing_enabled !== false,
    attendance_source: row.attendance_source ?? "GPS APP",
    photo_url: row.photo_url ?? "",
    tracking_consent: Boolean(row.tracking_consent),
    geofence_ids: geofenceIds,
  };
}