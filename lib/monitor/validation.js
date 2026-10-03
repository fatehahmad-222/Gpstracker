/**
 * Shared validation schemas (Zod).
 *
 * The SAME schemas validate the client form (via react-hook-form's resolver)
 * and the server route handler, so a rule can never exist on only one side.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Pakistan-specific formats
// ---------------------------------------------------------------------------

/** CNIC: 13 digits, displayed as 00000-0000000-0. */
export const cnicPattern = /^\d{5}-?\d{7}-?\d$/;

export function normalizeCnic(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length !== 13) return String(value || "");
  return `${digits.slice(0, 5)}-${digits.slice(5, 12)}-${digits.slice(12)}`;
}

/** Mobile: 03XX-XXXXXXX. */
export const phonePattern = /^(?:\+92|0)3\d{2}-?\d{7}$/;

export function normalizePhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("0")) {
    return `${digits.slice(0, 4)}-${digits.slice(4)}`;
  }
  // "+92" + a 10-digit local number is 12 digits, not 13. The local number is
  // 3 operator digits + 7 subscriber digits, so the 0 goes on the front.
  if (digits.length === 12 && digits.startsWith("92")) {
    return `0${digits.slice(2, 5)}-${digits.slice(5)}`;
  }
  return String(value || "");
}

export const cnicSchema = z
  .string()
  .trim()
  .refine((v) => cnicPattern.test(v), {
    message: "Format: 00000-0000000-0 (13 digits)",
  });

export const phoneSchema = z
  .string()
  .trim()
  .refine((v) => v === "" || phonePattern.test(v), {
    message: "Format: 03XX-XXXXXXX",
  });

export const emailSchema = z
  .string()
  .trim()
  .refine((v) => v === "" || /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v), {
    message: "Enter a valid email address",
  });

// ---------------------------------------------------------------------------
// App password requirements — the live checklist in the Employee form.
// Mirrored server-side in lib/monitor/password.js so the rules are enforced
// at hash time regardless of what the client sent.
// ---------------------------------------------------------------------------

export const PASSWORD_RULES = [
  { key: "length", label: "At least 8 characters", test: (v) => v.length >= 8 },
  { key: "upper", label: "At least 1 uppercase letter (A–Z)", test: (v) => /[A-Z]/.test(v) },
  { key: "lower", label: "At least 1 lowercase letter (a–z)", test: (v) => /[a-z]/.test(v) },
  { key: "number", label: "At least 1 number (0–9)", test: (v) => /\d/.test(v) },
  { key: "special", label: "At least 1 special character", test: (v) => /[^A-Za-z0-9]/.test(v) },
];

export function passwordChecklist(value = "") {
  return PASSWORD_RULES.map((r) => ({ ...r, ok: r.test(value) }));
}

export function isPasswordValid(value = "") {
  return PASSWORD_RULES.every((r) => r.test(value));
}

export const appPasswordSchema = z
  .string()
  .min(8, "At least 8 characters")
  .refine((v) => isPasswordValid(v), {
    message: "Password does not meet all requirements",
  });

// ---------------------------------------------------------------------------
// Employee
// ---------------------------------------------------------------------------

const timeString = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM (24h)");

export const employeeSchema = z.object({
  emp_code: z.string().trim().min(1, "Employee ID is required"),
  name: z.string().trim().min(2, "Employee name is required"),
  father_husband_name: z.string().trim().optional().default(""),
  dob: z.string().optional().default(""),
  gender: z.enum(["male", "female", "other"]),
  marital_status: z.enum(["", "single", "married", "divorced", "widowed"]).optional().default(""),
  cnic: cnicSchema,
  contact_no: phoneSchema,
  email: emailSchema,
  address: z.string().trim().optional().default(""),

  hire_date: z.string().min(1, "Hiring date is required"),
  education: z.string().trim().optional().default(""),
  department_id: z.string().uuid("Select a department"),
  designation_id: z.string().uuid("Select a job title"),
  last_job_history: z.string().trim().optional().default(""),

  shift_start: timeString,
  shift_end: timeString,
  overnight_approved: z.boolean().optional().default(false),

  basic_salary: z.coerce.number().min(0, "Enter a valid amount"),
  payment_method: z.enum(["", "bank", "cash", "cheque"]).optional().default(""),

  late_deduction: z.boolean().default(false),
  overtime_allowed: z.boolean().default(true),
  absent_deduction: z.boolean().default(false),
  wht_tax: z.boolean().default(false),

  app_password: appPasswordSchema,
  // The form posts a yes/no radio; the column is boolean. Transform on parse
  // so a route that forwards the parsed object cannot get the types wrong.
  geofencing_enabled: z
    .union([z.boolean(), z.enum(["yes", "no"])])
    .transform((v) => v === true || v === "yes"),
  geofence_ids: z.array(z.string().uuid()).optional().default([]),
  attendance_source: z.string().trim().optional().default("GPS APP"),

  photo_url: z.string().optional().default(""),
  tracking_consent: z.boolean().default(false),
})
  // Late Deduction / Overtime stay disabled until a department is chosen
  // (spec 4.3), so the values are ignored rather than rejected.
  .superRefine((data, ctx) => {
    const start = parseTime(data.shift_start);
    const end = parseTime(data.shift_end);

    if (start == null) {
      ctx.addIssue({ code: "custom", path: ["shift_start"], message: "Select a valid shift start" });
    }
    if (end == null) {
      ctx.addIssue({ code: "custom", path: ["shift_end"], message: "Select a valid shift end" });
    }
    if (start != null && end != null && start === end) {
      ctx.addIssue({
        code: "custom",
        path: ["shift_end"],
        message: "Shift end must differ from shift start",
      });
    }

    if (data.hire_date) {
      const today = new Date().toISOString().slice(0, 10);
      if (data.hire_date > today) {
        ctx.addIssue({
          code: "custom",
          path: ["hire_date"],
          message: "Future dates are disabled",
        });
      }
    }

    if (data.dob && data.dob > new Date().toISOString().slice(0, 10)) {
      ctx.addIssue({ code: "custom", path: ["dob"], message: "Date of birth cannot be in the future" });
    }

    if (data.geofencing_enabled === "yes" && (data.geofence_ids?.length ?? 0) === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["geofence_ids"],
        message: "Assign at least one location, or set Geo-Fencing to No",
      });
    }
  });

function parseTime(value) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || ""));
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h > 23 || m > 59) return null;
  return h * 60 + m;
}

// ---------------------------------------------------------------------------
// Policies
// ---------------------------------------------------------------------------

export const deductionPolicySchema = z.object({
  name: z.string().trim().min(1, "Policy name is required"),
  effective_from: z.string().min(1, "Effective from is required"),
  grace_minutes: z.coerce.number().int().min(0).max(240),
  method: z.enum(["fixed", "per_minute", "salary_based"]),
  amount: z.coerce.number().min(0).optional().default(0),
  // "department_id" would read naturally here, but the column and the other
  // two policy schemas both use scope_ref_id, so all three stay aligned.
  // The DB check constraint allows employee scope for every policy type, so a
  // single contractor can carry a different deduction.
  scope: z.enum(["all", "department", "employee"]),
  scope_ref_id: z.string().uuid().optional().default(""),
  max_deduction: z.coerce.number().min(0).optional().nullable().default(null),
  warn_after: z.coerce.number().int().min(1).max(100),
  status: z.enum(["active", "inactive"]).optional().default("active"),
  description: z.string().trim().optional().default(""),
})
  .superRefine((data, ctx) => {
    if (data.scope !== "all" && !data.scope_ref_id) {
      ctx.addIssue({
        code: "custom",
        path: ["scope_ref_id"],
        message: data.scope === "department" ? "Select a department" : "Select an employee",
      });
    }
    if (data.method !== "salary_based" && !(data.amount > 0)) {
      ctx.addIssue({
        code: "custom",
        path: ["amount"],
        message: "Enter an amount",
      });
    }
  });

export const presencePolicySchema = z
  .object({
    name: z.string().trim().min(1, "Policy name is required"),
    effective_from: z.string().min(1, "Effective date is required"),
    selfie_grace_minutes: z.coerce.number().int().min(1).max(120),
    notifications: z.coerce.number().int().min(1).max(3),
    scope: z.enum(["all", "department", "employee"]),
    scope_ref_id: z.string().uuid().optional().default(""),
    status: z.enum(["active", "inactive"]),
    description: z.string().trim().optional().default(""),
  })
  .superRefine((data, ctx) => {
    if (data.scope !== "all" && !data.scope_ref_id) {
      ctx.addIssue({
        code: "custom",
        path: ["scope_ref_id"],
        message: data.scope === "department" ? "Select a department" : "Select an employee",
      });
    }
  });

/**
 * Shared shape used by the list view and the API route. The type-specific
 * rules live in the two schemas above — discriminatedUnion needs a plain
 * ZodObject per option, which an `.and()` intersection is not.
 */
export const policyBaseSchema = z.object({
  type: z.enum(["late_early_deduction", "presence_check"]),
  name: z.string().trim().min(1, "Policy name is required"),
  effective_from: z.string().min(1, "Effective from is required"),
  status: z.enum(["active", "inactive"]).default("active"),
  scope: z.enum(["all", "department", "employee"]).default("all"),
  scope_ref_id: z.string().uuid().optional().default(""),
  description: z.string().trim().optional().default(""),
});

/** Pick the strict schema for a policy type, or the base shape as a fallback. */
export function policySchemaFor(type) {
  if (type === "late_early_deduction") return deductionPolicySchema;
  if (type === "presence_check") return presencePolicySchema;
  return policyBaseSchema;
}

// ---------------------------------------------------------------------------
// Geofences
// ---------------------------------------------------------------------------

const pointTuple = z.tuple([z.number(), z.number()]);

export const geofenceSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required"),
    type: z.enum(["circle", "polygon", "rectangle", "route"]),
    description: z.string().trim().optional().default(""),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#2563eb"),
    status: z.enum(["active", "inactive"]).default("active"),
    radius_m: z.coerce.number().min(1).max(100000).optional(),
    buffer_m: z.coerce.number().min(1).max(5000).default(50),
    travel_mode: z.enum(["Driving", "Walking", "Cycling", "Transit"]).optional(),
    // Optional: a circle is fully described by centre + radius, so requiring
    // geometry here would reject the payload the map picker actually sends.
    geometry: z.unknown().optional(),
    center_lat: z.coerce.number().optional(),
    center_lng: z.coerce.number().optional(),
    waypoints: z.array(z.object({ lat: z.number(), lng: z.number() })).optional().default([]),
    distance_km: z.coerce.number().optional(),
    duration_min: z.coerce.number().optional(),
    employee_ids: z.array(z.string().uuid()).optional().default([]),
  })
  .superRefine((data, ctx) => {
    if (data.type === "circle" && !(data.radius_m > 0)) {
      ctx.addIssue({ code: "custom", path: ["radius_m"], message: "Set a radius" });
    }
    if (data.type === "polygon" && !hasEnoughPoints(data.geometry, 3)) {
      ctx.addIssue({ code: "custom", path: ["geometry"], message: "Draw a polygon with at least 3 points" });
    }
    if (data.type === "rectangle" && !hasEnoughPoints(data.geometry, 4)) {
      ctx.addIssue({ code: "custom", path: ["geometry"], message: "Draw a rectangle" });
    }
    if (data.type === "route" && !hasEnoughPoints(data.geometry, 2)) {
      ctx.addIssue({ code: "custom", path: ["geometry"], message: "Set an origin and a destination" });
    }
  });

function hasEnoughPoints(geometry, min) {
  if (!geometry) return false;
  const coords = geometry?.coordinates ?? geometry;
  if (!Array.isArray(coords)) return false;
  const ring = coords[0]?.coordinates ? coords[0].coordinates : coords;
  return Array.isArray(ring) && ring.length >= min;
}

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

export const uuidSchema = z.string().uuid();

/** Paginated list query. */
export const listQuerySchema = z.object({
  q: z.string().trim().max(120).optional().default(""),
  department_id: z.string().optional().default(""),
  location_id: z.string().optional().default(""),
  employee_id: z.string().optional().default(""),
  status: z.string().optional().default(""),
  include_deleted: z.enum(["true", "false"]).optional().default("false"),
  page: z.coerce.number().int().min(1).max(10000).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
  sort: z.string().max(40).optional().default(""),
  dir: z.enum(["asc", "desc", ""]).optional().default(""),
});

export const dateQuerySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  tz: z.string().max(64).optional(),
});

/** Flatten a ZodError into `{ field: "first message" }` for form display. */
export function fieldErrors(error) {
  const out = {};
  if (!error?.issues) return out;
  for (const issue of error.issues) {
    const key = issue.path?.join(".") || "_root";
    if (!(key in out)) out[key] = issue.message;
  }
  return out;
}