import { requireContext, pageParams, MAX_PAGE_SIZE } from "@/lib/server/monitorClient";
import { readJson, validate, dbErrorResponse, writeAudit, ok } from "@/lib/server/api";
import { employeeFormSchema } from "@/lib/monitor/validation";
import {
  createEmployee,
  listEmployees as listEmployeeRows,
  withEmployeeLabels,
} from "@/lib/server/employees";

export const dynamic = "force-dynamic";

/** GET /api/monitor/employees */
export async function GET(request) {
  const ctx = await requireContext();
  if (ctx.response) return ctx.response;

  const { searchParams } = new URL(request.url);
  const { page, pageSize, from, to } = pageParams({
    page: searchParams.get("page"),
    pageSize: searchParams.get("page_size") || MAX_PAGE_SIZE,
  });

  try {
    const { rows, total } = await listEmployeeRows(ctx.supabase, {
      companyId: ctx.companyId,
      departmentId: searchParams.get("department_id") || null,
      designationId: searchParams.get("designation_id") || null,
      status: searchParams.get("status") || null,
      geofencing: searchParams.get("geofencing") || null,
      search: searchParams.get("q") || null,
      includeArchived: searchParams.get("include_archived") === "1",
      from,
      to,
    });

    return ok({
      rows: await withEmployeeLabels(ctx.supabase, { companyId: ctx.companyId, rows }),
      page,
      pageSize,
      total,
    });
  } catch (error) {
    return dbErrorResponse(error, "Could not load employees");
  }
}

/** POST /api/monitor/employees */
export async function POST(request) {
  const ctx = await requireContext({ write: true });
  if (ctx.response) return ctx.response;

  const body = await readJson(request);
  const parsed = validate(employeeFormSchema, body);
  if (!parsed.ok) return parsed.response;

  const { app_password: appPassword, geofence_ids: geofenceIds, ...values } = parsed.data;

  try {
    const { employee, geofencesLinked, generatedPassword } = await createEmployee(ctx.supabase, {
      companyId: ctx.companyId,
      values: { ...values, geofence_ids: geofenceIds },
      appPassword,
    });

    await writeAudit(ctx.supabase, {
      companyId: ctx.companyId,
      actor: { id: ctx.profile.id, email: ctx.user.email },
      action: "create",
      entityType: "employee",
      entityId: employee.id,
      summary: `Created employee ${employee.emp_code} (${employee.name})`,
      // Whether a password was set, never the password itself.
      meta: { appPasswordGenerated: Boolean(generatedPassword), geofencesLinked },
    });

    // The plaintext is surfaced once, for the admin to pass on, and is never
    // stored. It cannot be recovered afterwards — only reset.
    return ok(
      { employee, geofencesLinked, generatedPassword },
      201
    );
  } catch (error) {
    return dbErrorResponse(error, "Could not save this employee");
  }
}