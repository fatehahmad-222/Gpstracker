/**
 * Shared policy helpers for the Configuration routes.
 *
 * A policy is one row with a small set of real columns plus a `params` jsonb
 * whose shape depends on `type`. Keeping the split in one place means the
 * collection route and the [id] route cannot drift apart on which fields are
 * columns and which are params.
 */

import { summariseDeductions } from "@/lib/monitor/deduction";

export const POLICY_TYPES = [
  {
    value: "late_early_deduction",
    label: "Late / Early deduction Form",
    hint: "Charge employees for clocking in late or out early.",
  },
  {
    value: "presence_check",
    label: "Presence Check Form",
    hint: "Ask staff to confirm presence with a selfie on a schedule.",
  },
];

export const POLICY_SELECT =
  "id, name, type, description, effective_from, status, scope, scope_ref_id, params, created_at, updated_at";

/** Fields that live in `params` per type; everything else is a real column. */
export const PARAMS_BY_TYPE = {
  late_early_deduction: ["grace_minutes", "method", "amount", "max_deduction", "warn_after"],
  presence_check: ["selfie_grace_minutes", "notifications"],
};

export function isPolicyType(type) {
  return POLICY_TYPES.some((t) => t.value === type);
}

/** Split a validated policy into real columns and its `params` jsonb. */
export function toPolicyRow(values, type) {
  const params = {};
  const columnRow = {};

  for (const [key, value] of Object.entries(values)) {
    if (PARAMS_BY_TYPE[type]?.includes(key)) params[key] = value;
    else columnRow[key] = value;
  }

  // scope_ref_id must be null rather than "" for a company-wide policy: the
  // column is a uuid reference and an empty string is not null.
  if (columnRow.scope_ref_id === "" || columnRow.scope_ref_id === undefined) {
    columnRow.scope_ref_id = null;
  }
  if (!columnRow.status) columnRow.status = "active";

  return { columnRow, params };
}

/**
 * Attach `scope_label` and a worked deduction preview to each row.
 *
 * The preview answers "would this policy have deducted anything?" without the
 * UI having to reimplement the deduction maths.
 *
 * Both lookups are filtered by `companyId` explicitly rather than leaning on
 * RLS alone, so a misconfigured policy cannot surface another tenant's
 * department or employee name.
 */
export async function withScopeLabels(supabase, rows, companyId) {
  const deptIds = [...new Set(rows.map((r) => r.scope_ref_id).filter(Boolean))];

  const employeeIds = [
    ...new Set(
      rows
        .filter((r) => r.scope === "employee")
        .map((r) => r.scope_ref_id)
        .filter(Boolean)
    ),
  ];

  const [departments, employees] = await Promise.all([
    deptIds.length
      ? supabase.from("departments").select("id, name").in("id", deptIds).eq("company_id", companyId)
      : Promise.resolve({ data: [] }),
    employeeIds.length
      ? supabase.from("employees").select("id, name").in("id", employeeIds).eq("company_id", companyId)
      : Promise.resolve({ data: [] }),
  ]);

  const deptNames = Object.fromEntries((departments.data || []).map((d) => [d.id, d.name]));
  const employeeNames = Object.fromEntries((employees.data || []).map((e) => [e.id, e.name]));

  return rows.map((row) => ({
    ...row,
    scope_label:
      row.scope === "department"
        ? deptNames[row.scope_ref_id] || "Unknown department"
        : row.scope === "employee"
          ? employeeNames[row.scope_ref_id] || "Unknown employee"
          : "All employees",
    // Salary-based charges depend on the individual employee's salary, so a
    // single figure cannot be previewed here; null means "not predictable".
    deduction_preview:
      row.type === "late_early_deduction" && row.params?.method !== "salary_based"
        ? summariseDeductions([{ lateMinutes: 30 }], { params: row.params }).total
        : null,
  }));
}