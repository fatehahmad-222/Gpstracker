/**
 * Demo data for the GPS Work Force Monitor module.
 *
 * Synthetic Pakistani names, CNICs and phone numbers. Nothing here is real
 * personal data: the CNIC check digit and phone numbers are deliberately
 * fabricated, and the geo coordinates are real Sialkot / Lahore landmarks so
 * the maps look plausible.
 *
 * `scripts/seed.mjs` consumes this; `scripts/simulate-device.mjs` uses the
 * device profiles for ingestion.
 */

export const COMPANY = {
  id: "c0000000-0000-4000-8000-000000000001",
  code: "PK-PUN-SKT-MX05",
  name: "MetaXperts (Pvt) Ltd",
  timezone: "Asia/Karachi",
};

/** Sialkot / Lahore landmarks — real coordinates, used as fence centres. */
export const PLACES = {
  sialkotOffice: { name: "Sialkot Head Office", lat: 32.4945, lng: 74.5229 },
  sialkotHub: { name: "Sialkot Warehouse Hub", lat: 32.5106, lng: 74.5402 },
  gujranwala: { name: "Gujranwala Branch", lat: 32.1877, lng: 74.1945 },
  lahoreOffice: { name: "Lahore Regional Office", lat: 31.5204, lng: 74.3587 },
  lahoreHub: { name: "Lahore Distribution Hub", lat: 31.4416, lng: 74.3949 },
  faisalabad: { name: "Faisalabad Depot", lat: 31.4180, lng: 73.0791 },
};

export const DEPARTMENTS = [
  { name: "Accounts", code: "ACC" },
  { name: "Admin", code: "ADM" },
  { name: "Marketing", code: "MKT" },
  { name: "Operations", code: "OPS" },
  { name: "Sales", code: "SLS" },
  { name: "Social Media", code: "SOM" },
];

export const SUB_DEPARTMENTS = [
  { department: "Accounts", name: "Audit", code: "ACC-AUD" },
  { department: "Accounts", name: "Payroll", code: "ACC-PAY" },
  { department: "Operations", name: "Logistics", code: "OPS-LOG" },
  { department: "Operations", name: "Field Support", code: "OPS-FLD" },
  { department: "Marketing", name: "Brand", code: "MKT-BRD" },
  { department: "Sales", name: "Corporate Sales", code: "SLS-COR" },
];

export const DESIGNATIONS = [
  { department: "Accounts", name: "Accounts Officer", code: "ACC-OF" },
  { department: "Accounts", name: "Senior Accountant", code: "ACC-SA" },
  { department: "Accounts", name: "Accountant Manager", code: "ACC-AM" },
  { department: "Admin", name: "Admin Officer", code: "ADM-OF" },
  { department: "Admin", name: "Office Assistant", code: "ADM-OA" },
  { department: "Marketing", name: "Marketing Executive", code: "MKT-EX" },
  { department: "Marketing", name: "Brand Manager", code: "MKT-BM" },
  { department: "Operations", name: "Operations Supervisor", code: "OPS-SUP" },
  { department: "Operations", name: "Field Officer", code: "OPS-FO" },
  { department: "Operations", name: "Delivery Rider", code: "OPS-DR" },
  { department: "Sales", name: "Sales Executive", code: "SLS-EX" },
  { department: "Sales", name: "Regional Sales Manager", code: "SLS-RSM" },
  { department: "Social Media", name: "Social Media Executive", code: "SOM-EX" },
  { department: "Social Media", name: "Content Creator", code: "SOM-CC" },
];

/** First name (male, female) + surname pools — 40 distinct employees. */
const MALE = [
  "Ahmed", "Bilal", "Usman", "Hamza", "Zain", "Faisal", "Kashif", "Imran",
  "Tariq", "Adnan", "Raza", "Shahid", "Nadeem", "Waqas", "Junaid", "Asad",
  "Danish", "Rehan",
];
const FEMALE = [
  "Ayesha", "Fatima", "Zainab", "Maria", "Hina", "Sadia", "Nimra", "Rabia",
  "Sana", "Amna", "Iqra", "Kiran", "Bushra", "Nazia", "Farzana", "Uzma",
  "Saima", "Shazia",
];
const SURNAMES = [
  "Khan", "Butt", "Chaudhry", "Malik", "Raza", "Aslam", "Iqbal", "Javed",
  "Mahmood", "Nawaz", "Qureshi", "Sheikh", "Siddiqui", "Tariq", "Yousaf",
  "Abbasi", "Hameed", "Mirza",
];

/** Deterministic pseudo-random so every seed run produces the same data. */
export function makeRng(seed = 20260925) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function buildEmployees(count = 40) {
  const rng = makeRng();
  const employees = [];

  for (let i = 0; i < count; i++) {
    const isMale = rng() > 0.42;
    const pool = isMale ? MALE : FEMALE;
    const first = pool[i % pool.length];
    const last = SURNAMES[(i * 7 + 3) % SURNAMES.length];
    const name = `${first} ${last}`;
    const department = DEPARTMENTS[i % DEPARTMENTS.length].name;
    const designations = DESIGNATIONS.filter((d) => d.department === department);
    const designation = designations[Math.floor(rng() * designations.length)]?.name || "Executive";

    // ~1 in 8 employees is inactive, so the Inactive view has content.
    const inactive = i % 8 === 7;
    // ~1 in 13 is soft-deleted, so "Deleted Logs" has content.
    const deleted = i % 13 === 12;

    // Mostly day shifts, a couple of overnight (spec 4.3 requires support).
    const shift = i % 11 === 5
      ? { start: "21:00", end: "06:00" }
      : i % 7 === 3
        ? { start: "17:00", end: "23:59" }
        : i % 5 === 2
          ? { start: "08:00", end: "16:00" }
          : { start: "09:00", end: "18:00" };

    // Device health spread, so the Command Center has a realistic mix.
    const deviceProfile = i % 9 === 0
      ? { android_version: "11", model: "SM-A125F", manufacturer: "Samsung", supported: false }
      : i % 9 === 4
        ? { android_version: "13", model: "Infinix X6816", manufacturer: "Infinix", supported: false }
        : i % 3 === 0
          ? { android_version: "16", model: "SM-A175F", manufacturer: "Samsung", supported: true }
          : { android_version: "15", model: "Redmi Note 13", manufacturer: "Xiaomi", supported: true };

    employees.push({
      emp_code: `MX-${String(i + 1).padStart(3, "0")}`,
      name,
      father_husband_name: isMale ? "—" : `${SURNAMES[(i * 3) % SURNAMES.length]} (husband)`,
      gender: isMale ? "male" : "female",
      marital_status: rng() > 0.55 ? "married" : "single",
      cnic: fakeCnic(rng),
      contact_no: fakePhone(rng),
      email: `${first.toLowerCase()}.${last.toLowerCase().replace(/[^a-z]/g, "")}@metaxperts.example`,
      address: `${10 + i} ${SURNAMES[i % SURNAMES.length]} Road, Sialkot`,
      hire_date: hireDate(rng),
      education: rng() > 0.5 ? "BSc Computer Science" : "BCom",
      department,
      designation,
      last_job_history: rng() > 0.6 ? `${SURNAMES[(i * 5) % SURNAMES.length]} Traders` : "",
      shift_start: shift.start,
      shift_end: shift.end,
      basic_salary: 25000 + Math.floor(rng() * 9) * 5000,
      payment_method: rng() > 0.7 ? "bank" : "cash",
      late_deduction: rng() > 0.6,
      overtime_allowed: rng() > 0.35,
      absent_deduction: rng() > 0.55,
      wht_tax: rng() > 0.8,
      geofencing_enabled: rng() > 0.25,
      attendance_source: "GPS APP",
      status: inactive ? "inactive" : "active",
      deleted,
      tracking_consent: true,
      device: {
        device_id: `dev-${(i + 1).toString().padStart(4, "0")}`,
        app_version: i % 6 === 0 ? "3.4.0" : "3.6.1",
        ...deviceProfile,
      },
    });
  }

  return employees;
}

/** Synthetic CNIC in 00000-0000000-0 form. The digits are fabricated. */
function fakeCnic(rng) {
  const five = String(Math.floor(rng() * 90000) + 10000);
  const seven = String(Math.floor(rng() * 9000000) + 1000000);
  return `${five}-${seven}-${Math.floor(rng() * 10)}`;
}

/** Synthetic 03XX-XXXXXXX number. */
function fakePhone(rng) {
  const prefix = ["0300", "0311", "0321", "0333", "0345", "0306"][Math.floor(rng() * 6)];
  return `${prefix}-${String(Math.floor(rng() * 9000000) + 1000000)}`;
}

function hireDate(rng) {
  const year = 2019 + Math.floor(rng() * 7);
  const month = String(1 + Math.floor(rng() * 12)).padStart(2, "0");
  const day = String(1 + Math.floor(rng() * 28)).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export const POLICIES = [
  {
    name: "Standard Late Deduction — Grace 15 min",
    type: "late_early_deduction",
    description: "15 minutes grace, then PKR 150 per occurrence, capped at PKR 2,000 per month.",
    params: {
      grace_minutes: 15,
      method: "fixed",
      amount: 150,
      max_deduction: 2000,
      warn_after: 5,
    },
    scope: "all",
  },
  {
    name: "Night Shift Per-Minute Deduction",
    type: "late_early_deduction",
    description: "Applied to Operations night shift: PKR 20 per minute past grace.",
    params: {
      grace_minutes: 10,
      method: "per_minute",
      amount: 20,
      max_deduction: 1500,
      warn_after: 3,
    },
    scope: "department",
    scope_ref_department: "Operations",
  },
  {
    name: "Sales Salary-Based Late Deduction",
    type: "late_early_deduction",
    description: "Pro-rata of daily salary for time missed. Applies to Sales only.",
    params: {
      grace_minutes: 20,
      method: "salary_based",
      amount: 0,
      daily_salary_divisor: 30,
      max_deduction: null,
      warn_after: 4,
    },
    scope: "department",
    scope_ref_department: "Sales",
  },
  {
    name: "Presence Integrity Check — Office Staff",
    type: "presence_check",
    description:
      "Random selfie verification during the shift. 5 minute window, 3 notifications before action.",
    params: { selfie_grace_minutes: 5, notifications: 3 },
    scope: "department",
    scope_ref_department: "Admin",
  },
  {
    name: "Presence Check — Field Officers",
    type: "presence_check",
    description: "Selfie within 10 minutes of the notification for field staff.",
    params: { selfie_grace_minutes: 10, notifications: 2 },
    scope: "all",
  },
];

export const GEOFENCES = [
  {
    name: "Sialkot Head Office",
    type: "circle",
    place: "sialkotOffice",
    radius_m: 250,
    color: "#1F7F6B",
    description: "Primary office and attendance point.",
  },
  {
    name: "Sialkot Warehouse Hub",
    type: "circle",
    place: "sialkotHub",
    radius_m: 400,
    color: "#0EA5E9",
    description: "Distribution and loading bay.",
  },
  {
    name: "Sialkot Office Compound",
    type: "rectangle",
    sw: { lat: 32.4890, lng: 74.5160 },
    ne: { lat: 32.4990, lng: 74.5290 },
    color: "#8B5CF6",
    description: "Rectangular perimeter around the office plot.",
  },
  {
    name: "Lahore Regional Office",
    type: "circle",
    place: "lahoreOffice",
    radius_m: 300,
    color: "#EAB308",
    description: "Lahore regional office.",
  },
  {
    name: "Lahore Distribution Hub",
    type: "circle",
    place: "lahoreHub",
    radius_m: 500,
    color: "#DC2626",
    description: "Lahore distribution hub.",
  },
  {
    name: "Gujranwala Branch",
    type: "circle",
    place: "gujranwala",
    radius_m: 300,
    color: "#F97316",
    description: "Gujranwala branch office.",
  },
  {
    name: "Sialkot - Sialkot Route",
    type: "route",
    color: "#3B82F6",
    buffer_m: 150,
    travel_mode: "Driving",
    description: "Standard field round: head office to warehouse hub.",
    line: [
      [74.5229, 32.4945],
      [74.5300, 32.5010],
      [74.5402, 32.5106],
    ],
  },
  {
    name: "Lahore Ring Route",
    type: "route",
    color: "#14B8A6",
    buffer_m: 200,
    travel_mode: "Driving",
    description: "Lahore office to distribution hub via Canal Road.",
    line: [
      [74.3587, 31.5204],
      [74.3700, 31.4900],
      [74.3850, 31.4600],
      [74.3949, 31.4416],
    ],
  },
  {
    name: "Sialkot Market Zone",
    type: "polygon",
    color: "#EC4899",
    description: "Field visit zone around Sialkot city centre.",
    polygon: [
      [74.5120, 32.4880],
      [74.5340, 32.4880],
      [74.5340, 32.5020],
      [74.5120, 32.5020],
      [74.5120, 32.4880],
    ],
  },
];

/** Which employees get which fences — keeps "Assigned Locations" non-empty. */
export function assignmentsFor(employee, geofenceIndexes) {
  const assigned = [];
  if (employee.geofencing_enabled) {
    assigned.push(geofenceIndexes[employee.department === "Sales" ? 3 : 0]);
  }
  // Everyone tracks at least their own branch.
  assigned.push(geofenceIndexes[1 % geofenceIndexes.length]);
  return [...new Set(assigned)];
}

export const EVENT_TYPES = [
  "data_cleared",
  "logged_in_not_synced",
  "second_device",
  "auto_time_off",
  "time_diff",
  "location_off",
  "power_off",
  "force_stop",
  "battery_restrict",
  "dead_zone",
  "developer_mode",
  "fake_gps",
  "out_of_zone",
  "heartbeat_gap",
  "impossible_travel",
  "logged_out",
  "admin_logout",
  "sim_change",
  "old_app",
  "battery_low",
];

export const EVENT_SEVERITY = {
  data_cleared: "critical",
  logged_in_not_synced: "critical",
  second_device: "high",
  auto_time_off: "high",
  time_diff: "medium",
  location_off: "high",
  power_off: "medium",
  force_stop: "high",
  battery_restrict: "medium",
  dead_zone: "medium",
  developer_mode: "high",
  fake_gps: "critical",
  out_of_zone: "high",
  heartbeat_gap: "medium",
  impossible_travel: "critical",
  logged_out: "medium",
  admin_logout: "low",
  sim_change: "high",
  old_app: "low",
  battery_low: "low",
};

/**
 * Categories mirroring `SIGNAL_BY_KEY` in lib/monitor/signals.js.
 *
 * Duplicated because this file has to stay import-free (node loads it directly,
 * with no build step or `@/` alias). `tests/unit/alerts.test.js` asserts the two
 * stay in step, so drift fails the build rather than quietly mis-filing demo
 * alerts.
 */
export const EVENT_CATEGORY = {
  data_cleared: "Data Loss",
  logged_in_not_synced: "Data Loss",
  no_sync_24h: "Data Pending",
  unsupported: "Accuracy Problems",
  second_device: "Possible Fraud",
  location_off: "Tracking Lost",
  force_stop: "Tracking Lost",
  auto_time_off: "Time Tampering",
  time_diff: "Time Tampering",
  power_off: "Tracking Lost",
  battery_restrict: "Tracking Lost",
  dead_zone: "Tracking Lost",
  developer_mode: "Possible Fraud",
  fake_gps: "Possible Fraud",
  out_of_zone: "Accuracy Problems",
  heartbeat_gap: "Tracking Lost",
  impossible_travel: "Possible Fraud",
  logged_out: "Tracking Lost",
  admin_logout: "Other",
  sim_change: "Possible Fraud",
  old_app: "Other",
  battery_low: "Other",
  dead_zone_pending: "Tracking Lost",
  heartbeat_detail: "Tracking Lost",
};

/** Severities that belong in a manager's queue; low-severity noise is excluded. */
export const VIOLATION_SEVERITIES = ["critical", "high", "medium"];