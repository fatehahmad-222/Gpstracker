import { z } from "zod";

/**
 * Departments, Sub-Departments and Designations are the same shape — a name, an
 * optional code, a status, and a parent — so they share one server module, one
 * set of Zod schemas and one client component.
 *
 * `spec 4.3` treats them as one "Configuration" section, and the reference
 * product's three screens differ only in which parent they filter by.
 */

export const ORG_UNITS = {
  departments: {
    table: "departments",
    label: "Department",
    plural: "Departments",
    // Order by name; the counts come from a separate head-count query.
    listSelect: "id, name, code, status, created_at",
    hasDepartment: false,
    hasSubDepartment: false,
    // unique (company_id, name)
    conflictColumns: ["company_id", "name"],
  },
  sub_departments: {
    table: "sub_departments",
    label: "Sub-Department",
    plural: "Sub-Departments",
    listSelect: "id, name, code, status, department_id, created_at",
    hasDepartment: true,
    hasSubDepartment: false,
    conflictColumns: ["company_id", "department_id", "name"],
  },
  designations: {
    table: "designations",
    label: "Designation",
    plural: "Designations",
    listSelect:
      "id, name, code, status, department_id, sub_department_id, created_at",
    hasDepartment: true,
    hasSubDepartment: true,
    // unique (company_id, name)
    conflictColumns: ["company_id", "name"],
  },
};

const statusSchema = z.enum(["active", "inactive"]);

const baseFields = {
  name: z.string().trim().min(2, "Enter at least 2 characters").max(120),
  code: z
    .string()
    .trim()
    .max(24)
    .optional()
    .or(z.literal(""))
    .transform((v) => v || null),
  status: statusSchema.optional().default("active"),
};

/** Build the create schema for one org unit, including its parent rules. */
export function createSchemaFor(kind) {
  const spec = ORG_UNITS[kind];
  if (!spec) throw new Error(`Unknown org unit: ${kind}`);

  const shape = { ...baseFields };
  if (spec.hasDepartment) shape.department_id = z.string().uuid("Select a department");
  if (spec.hasSubDepartment) {
    shape.sub_department_id = z.string().uuid().optional().nullable().default(null);
  }

  return z.object(shape);
}

/**
 * Patch schema: every field optional, but an empty body is a mistake worth
 * reporting rather than silently treating as a no-op.
 */
export function patchSchemaFor(kind) {
  const full = createSchemaFor(kind);
  const shape = {};
  for (const [key, value] of Object.entries(full.shape)) {
    // A PATCH must not re-apply create-time defaults, so drop `.default()`.
    let inner = value;
    while (inner && typeof inner._def?.defaultValue !== "undefined") inner = inner._def.innerType;
    shape[key] = inner;
  }
  return z.object(shape).refine((v) => Object.keys(v).length > 0, {
    message: "Nothing to update",
  });
}

/**
 * Rows for the list screen, with an optional live headcount.
 *
 * Headcounts come from `employees`, so this runs two queries rather than a
 * join: a left join across every employee row would make Postgres materialise
 * the whole company per config page load.
 */
export async function listOrgUnits(supabase, { kind, companyId, departmentId, includeInactive }) {
  const spec = ORG_UNITS[kind];

  let query = supabase.from(spec.table).select(spec.listSelect).eq("company_id", companyId);
  if (!includeInactive) query = query.eq("status", "active");
  if (spec.hasDepartment && departmentId) query = query.eq("department_id", departmentId);

  const { data, error } = await query.order("name", { ascending: true });
  if (error) throw error;

  const { data: employees } = await supabase
    .from("employees")
    .select("id, department_id, sub_department_id, designation_id")
    .eq("company_id", companyId)
    .eq("status", "active");

  const countFor = (row) => {
    if (!employees) return 0;
    if (kind === "departments") {
      return employees.filter((e) => e.department_id === row.id).length;
    }
    if (kind === "sub_departments") {
      return employees.filter((e) => e.sub_department_id === row.id).length;
    }
    return employees.filter((e) => e.designation_id === row.id).length;
  };

  return (data || []).map((row) => ({ ...row, employee_count: countFor(row) }));
}

/**
 * Create one org unit.
 *
 * `conflictColumns` is passed to PostgREST's upsert so a repeated save updates
 * the existing row rather than raising a unique violation. `ignoreDuplicates`
 * stays false so callers can detect the update via the returned row.
 */
export async function createOrgUnit(supabase, { kind, companyId, values }) {
  const spec = ORG_UNITS[kind];
  const row = { ...values, company_id: companyId };

  const { data, error } = await supabase
    .from(spec.table)
    .upsert(row, { onConflict: spec.conflictColumns.join(",") })
    .select("*")
    .single();

  if (error) throw error;
  return data;
}

export async function updateOrgUnit(supabase, { kind, companyId, id, values }) {
  const spec = ORG_UNITS[kind];

  // The company filter is what stops one tenant editing another's row even
  // though the route handler already checked the caller's company.
  const { data, error } = await supabase
    .from(spec.table)
    .update(values)
    .eq("id", id)
    .eq("company_id", companyId)
    .select("*")
    .maybeSingle();

  if (error) throw error;
  return data;
}

/**
 * Delete, or archive when the table is referenced.
 *
 * Departments, sub-departments and designations are all foreign-keyed from
 * `employees`, and deleting one would either cascade-delete employees or fail
 * on the constraint. Spec 9 prefers data to survive mistakes, so a unit that
 * still has employees is archived instead of removed.
 */
export async function deleteOrgUnit(supabase, { kind, companyId, id }) {
  const spec = ORG_UNITS[kind];
  const { count } = await supabase
    .from("employees")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId)
    .eq(kind === "departments" ? "department_id" : kind === "sub_departments" ? "sub_department_id" : "designation_id", id);

  if (count > 0) {
    const archived = await updateOrgUnit(supabase, { kind, companyId, id, values: { status: "inactive" } });
    return { deleted: false, archived: true, employeeCount: count, row: archived };
  }

  const { error } = await supabase
    .from(spec.table)
    .delete()
    .eq("id", id)
    .eq("company_id", companyId);

  if (error) throw error;
  return { deleted: true, archived: false, employeeCount: 0, row: null };
}

/**
 * A read-only employee list for pickers (policy scope, export dialogs).
 *
 * Employee Management (spec 5) owns the real employee screen; this exists only
 * so Configuration can fill a scope picker without duplicating that whole
 * module, and it is deliberately not exposed for writes.
 */
export async function listEmployees(supabase, { companyId, departmentId, search, limit = 200 }) {
  let query = supabase
    .from("employees")
    .select("id, name, code, department_id, sub_department_id, designation_id, status")
    .eq("company_id", companyId)
    .eq("status", "active")
    .order("name", { ascending: true })
    .limit(limit);

  if (departmentId) query = query.eq("department_id", departmentId);
  if (search) {
    // `or` takes a PostgREST filter string, so the search term is wrapped in
    // double quotes and every character that could end that quoted literal or
    // start a new filter is removed first.
    const term = `"${String(search).replace(/["\\%,()]/g, " ")}"`;
    query = query.or(`name.ilike.%${term}%,code.ilike.%${term}%`);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

/** Human summary for the audit log. */
export function describeOrgUnit(kind, row) {
  return `${ORG_UNITS[kind].label} "${row?.name ?? "unknown"}"`;
}