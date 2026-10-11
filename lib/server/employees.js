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
  "overnight_approved",
  "absent_deduction",
  "wht_tax",
  "geofencing_enabled",
  "attendance_source",
  "photo_url",
  "tracking_consent",
  "status",
  "created_at",
].join(", ");
