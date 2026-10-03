/**
 * Shared CSV column definitions for the employee import/export pair.
 *
 * Both directions use this file so a column added to the export is immediately
 * accepted by the import, and vice versa.
 */

/** Columns written by the export, in order. */
export const EMPLOYEE_CSV_COLUMNS = [
  { key: "emp_code", label: "Employee ID" },
  { key: "name", label: "Name" },
  { key: "father_husband_name", label: "Father/Husband Name" },
  { key: "cnic", label: "CNIC" },
  { key: "contact_no", label: "Contact No" },
  { key: "email", label: "Email" },
  { key: "gender", label: "Gender" },
  { key: "marital_status", label: "Marital Status" },
  { key: "dob", label: "Date of Birth" },
  { key: "hire_date", label: "Hiring Date" },
  { key: "department", label: "Department" },
  { key: "designation", label: "Designation" },
  { key: "shift_start", label: "Shift Start" },
  { key: "shift_end", label: "Shift End" },
  { key: "basic_salary", label: "Basic Salary" },
  { key: "payment_method", label: "Payment Method" },
  { key: "education", label: "Education" },
  { key: "address", label: "Address" },
  { key: "geofencing_enabled", label: "Geo-Fencing" },
  { key: "attendance_source", label: "Attendance Source" },
  { key: "status", label: "Status" },
];

/**
 * Header spellings accepted on import, normalised to a canonical column label.
 *
 * Admins edit these spreadsheets by hand, so "Employee ID", "employee_id",
 * "Emp Code" and "empcode" all have to land on the same field.
 *
 * The phone lives in one exported column, "Contact No". "Phone" and "Mobile" are
 * accepted as *input* aliases for it rather than exported as a second column,
 * which would otherwise carry the same value twice and collide on import.
 */
const HEADER_ALIASES = {
  employeeid: "Employee ID",
  employee_id: "Employee ID",
  empcode: "Employee ID",
  emp_code: "Employee ID",
  code: "Employee ID",
  employeename: "Name",
  employee_name: "Name",
  fullname: "Name",
  name: "Name",
  fatherhusbandname: "Father/Husband Name",
  father_husband_name: "Father/Husband Name",
  cnic: "CNIC",
  contactno: "Contact No",
  contact_no: "Contact No",
  phone: "Contact No",
  mobile: "Contact No",
  email: "Email",
  emailaddress: "Email",
  gender: "Gender",
  maritalstatus: "Marital Status",
  marital_status: "Marital Status",
  dob: "Date of Birth",
  dateofbirth: "Date of Birth",
  date_of_birth: "Date of Birth",
  hiredate: "Hiring Date",
  hire_date: "Hiring Date",
  joiningdate: "Hiring Date",
  department: "Department",
  departmentname: "Department",
  department_name: "Department",
  designation: "Designation",
  designationname: "Designation",
  designation_name: "Designation",
  jobtitle: "Designation",
  shiftstart: "Shift Start",
  shift_start: "Shift Start",
  shiftend: "Shift End",
  shift_end: "Shift End",
  basicsalary: "Basic Salary",
  basic_salary: "Basic Salary",
  salary: "Basic Salary",
  paymentmethod: "Payment Method",
  payment_method: "Payment Method",
  education: "Education",
  address: "Address",
  geofencing: "Geo-Fencing",
  geofencingenabled: "Geo-Fencing",
  geofencing_enabled: "Geo-Fencing",
  geofencing_on: "Geo-Fencing",
  attendancesource: "Attendance Source",
  attendance_source: "Attendance Source",
  status: "Status",
};

/**
 * Fold a raw header cell to its canonical label.
 *
 * Comparison ignores case, spaces, hyphens, slashes and underscores, so
 * "Employee ID", "employee-id" and "employee_id" all match.
 */
export function canonicalHeader(raw) {
  const original = String(raw ?? "").trim();
  const key = original.toLowerCase().replace(/[\s/_-]/g, "");
  return HEADER_ALIASES[key] ?? original;
}

/** "yes"/"no"/"true"/"1"/"on" and their negatives; null when unrecognised. */
export function parseYesNo(value) {
  const v = String(value ?? "").trim().toLowerCase();
  if (["yes", "y", "true", "1", "on", "enabled"].includes(v)) return true;
  if (["no", "n", "false", "0", "off", "disabled"].includes(v)) return false;
  return null;
}