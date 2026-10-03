import { randomBytes } from "crypto";

import { requireContext } from "@/lib/server/monitorClient";
import { dbErrorResponse, writeAudit, ok } from "@/lib/server/api";
import { employeeSchema } from "@/lib/monitor/validation";
import { parseEmployeeCsv } from "@/lib/monitor/employees-csv";
import { createEmployee } from "@/lib/server/employees";

export const dynamic = "force-dynamic";

/** Reject anything larger than a plausible employee sheet before parsing it. */
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;

/** Cap on rows created in one request so a bad upload cannot lock the API up. */
const MAX_ROWS = 500;

/** "Sales" / " sales " -> matching uuid, case-insensitively. */
const normalise = (value) => String(value ?? "").trim().toLowerCase();

/**
 * Build the name -> id maps the CSV needs.
 *
 * One query per table for the whole file: resolving names row-by-row would send
 * two queries per employee.
 */
async function loadLookups(supabase, companyId) {
  const [departments, designations] = await Promise.all([
    supabase.from("departments").select("id, name").eq("company_id", companyId).eq("status", "active"),
    supabase.from("designations").select("id, name").eq("company_id", companyId).eq("status", "active"),
  ]);

  const index = (rows) =>
    Object.fromEntries((rows || []).map((r) => [normalise(r.name), r.id]));

  return { departments: index(departments.data), designations: index(designations.data) };
}

/**
 * A random app password, returned once so the admin can pass it on.
 *
 * Ambiguous characters (0/O, 1/l/I) are excluded: this gets read aloud or copied
 * off a screen by someone in the field.
 */
function generateAppPassword() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const body = [...randomBytes(12)].map((b) => alphabet[b % alphabet.length]).join("");
  return `Mon${body}7`;
}

/**
 * POST /api/monitor/employees/import  (multipart/form-data, field "file")
 *
 * Order matters: parse the sheet, resolve department/designation names to ids,
 * then validate each row against the real employee schema. Validating first
 * would fail every row, because the sheet carries names where the schema wants
 * uuids.
 *
 * Each row is independent — a bad row is reported with its line number and never
 * partially written.
 */
export async function POST(request) {
  const ctx = await requireContext({ write: true });
  if (ctx.response) return ctx.response;

  let file;
  try {
    const form = await request.formData();
    file = form.get("file");
  } catch {
    return Response.json({ error: "Send the file as multipart form data" }, { status: 400 });
  }

  if (!file || typeof file === "string") {
    return Response.json({ error: "Choose a CSV file to import" }, { status: 400 });
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    return Response.json({ error: "That file is too large (limit 2 MB)" }, { status: 413 });
  }

  const parsed = parseEmployeeCsv(await file.text());
  const errors = [...parsed.errors];

  if (!parsed.rows.length) {
    return Response.json(
      { error: "No valid rows found", imported: 0, errors },
      { status: 400 }
    );
  }

  if (parsed.rows.length > MAX_ROWS) {
    return Response.json(
      { error: `That file has ${parsed.rows.length} rows; the limit is ${MAX_ROWS} per import` },
      { status: 400 }
    );
  }

  try {
    const lookups = await loadLookups(ctx.supabase, ctx.companyId);

    const imported = [];
    const failed = [];

    for (const row of parsed.rows) {
      const departmentId = lookups.departments[normalise(row.values.department)];
      const designationId = lookups.designations[normalise(row.values.designation)];

      const appPassword = generateAppPassword();

      const payload = {
        ...row.values,
        department_id: departmentId,
        designation_id: designationId,
        app_password: appPassword,
      };

      const issues = [];

      if (!row.values.department) {
        issues.push({ field: "department", message: "Department is required" });
      } else if (!departmentId) {
        issues.push({ field: "department", message: `No department named "${row.values.department}"` });
      }

      if (!row.values.designation) {
        issues.push({ field: "designation", message: "Designation is required" });
      } else if (!designationId) {
        issues.push({ field: "designation", message: `No designation named "${row.values.designation}"` });
      }

      const validated = employeeSchema.safeParse(payload);
      if (!validated.success) {
        for (const issue of validated.error.issues) {
          issues.push({ field: issue.path.join(".") || "row", message: issue.message });
        }
      }

      if (issues.length) {
        failed.push({ line: row.line, label: row.label, issues });
        continue;
      }

      try {
        const { employee } = await createEmployee(ctx.supabase, {
          companyId: ctx.companyId,
          appPassword,
          values: validated.data,
        });

        imported.push({ emp_code: employee.emp_code, name: employee.name, appPassword });
      } catch {
        failed.push({
          line: row.line,
          label: row.label,
          issues: [{ field: "row", message: "Could not be saved — the Employee ID may already exist" }],
        });
      }
    }

    await writeAudit(ctx.supabase, {
      companyId: ctx.companyId,
      actor: { id: ctx.profile.id, email: ctx.user.email },
      action: "create",
      entityType: "employee",
      entityId: null,
      summary: `Imported ${imported.length} employee(s) from CSV`,
      meta: { imported: imported.length, failed: failed.length },
    });

    return ok({
      imported: imported.length,
      failed: failed.length,
      // Returned exactly once; only the hashes are stored.
      credentials: imported,
      errors: [...errors, ...failed],
    });
  } catch (error) {
    return dbErrorResponse(error, "Could not import employees");
  }
}