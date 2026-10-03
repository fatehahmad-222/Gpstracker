import { requireContext } from "@/lib/server/monitorClient";
import { readJson, validate, dbErrorResponse, writeAudit, ok, notFound } from "@/lib/server/api";
import { employeeFormSchema } from "@/lib/monitor/validation";
import {
  EMPLOYEE_SELECT,
  updateEmployee,
  archiveEmployee,
  listEmployeeGeofences,
  withEmployeeLabels,
} from "@/lib/server/employees";

export const dynamic = "force-dynamic";

/** GET /api/monitor/employees/[id] — the full record for the edit form. */
export async function GET(request, { params }) {
  const ctx = await requireContext();
  if (ctx.response) return ctx.response;

  const { id } = await params;

  try {
    const { data, error } = await ctx.supabase
      .from("employees")
      .select(EMPLOYEE_SELECT)
      .eq("id", id)
      .eq("company_id", ctx.companyId)
      .maybeSingle();

    if (error) throw error;
    if (!data) return notFound("Employee not found");

    const geofenceIds = await listEmployeeGeofences(ctx.supabase, {
      companyId: ctx.companyId,
      employeeId: id,
    });

    const [row] = await withEmployeeLabels(ctx.supabase, {
      companyId: ctx.companyId,
      rows: [data],
    });

    return ok({ employee: row, geofenceIds });
  } catch (error) {
    return dbErrorResponse(error, "Could not load this employee");
  }
}

/** PATCH /api/monitor/employees/[id] */
export async function PATCH(request, { params }) {
  const ctx = await requireContext({ write: true });
  if (ctx.response) return ctx.response;

  const { id } = await params;
  const body = await readJson(request);
  const parsed = validate(employeeFormSchema, body);
  if (!parsed.ok) return parsed.response;

  const { app_password: appPassword, geofence_ids: geofenceIds, ...values } = parsed.data;

  try {
    const employee = await updateEmployee(ctx.supabase, {
      companyId: ctx.companyId,
      id,
      values,
      geofenceIds,
      appPassword,
    });

    if (!employee) return notFound("Employee not found");

    await writeAudit(ctx.supabase, {
      companyId: ctx.companyId,
      actor: { id: ctx.profile.id, email: ctx.user.email },
      action: "update",
      entityType: "employee",
      entityId: id,
      summary: `Updated employee ${employee.emp_code} (${employee.name})`,
      meta: { appPasswordSet: Boolean(appPassword), geofencesLinked: geofenceIds?.length ?? null },
    });

    return ok({ employee });
  } catch (error) {
    return dbErrorResponse(error, "Could not save this employee");
  }
}

/**
 * DELETE /api/monitor/employees/[id]
 *
 * Soft-deletes by default. Pass `?restore=1` to bring an archived employee back,
 * which is why this is not a plain row delete: attendance, sessions and events
 * all point at `employees`.
 */
export async function DELETE(request, { params }) {
  const ctx = await requireContext({ write: true });
  if (ctx.response) return ctx.response;

  const { id } = await params;
  const restore = new URL(request.url).searchParams.get("restore") === "1";

  try {
    const row = await archiveEmployee(ctx.supabase, {
      companyId: ctx.companyId,
      id,
      deleted: !restore,
    });

    if (!row) return notFound("Employee not found");

    await writeAudit(ctx.supabase, {
      companyId: ctx.companyId,
      actor: { id: ctx.profile.id, email: ctx.user.email },
      action: restore ? "restore" : "archive",
      entityType: "employee",
      entityId: id,
      summary: restore
        ? `Restored employee ${row.emp_code} (${row.name})`
        : `Archived employee ${row.emp_code} (${row.name})`,
    });

    return ok({ employee: row, restored: restore });
  } catch (error) {
    return dbErrorResponse(error, restore ? "Could not restore this employee" : "Could not archive this employee");
  }
}