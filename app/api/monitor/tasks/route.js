import { requireContext, badRequest } from "@/lib/server/monitorClient";
import { dbErrorResponse, notFound, ok, readJson, writeAudit } from "@/lib/server/api";
import { validateTask, resolveAssignee } from "@/lib/monitor/fieldTasks";

export const dynamic = "force-dynamic";

/**
 * GET /api/monitor/tasks
 * POST /api/monitor/tasks
 *
 * Field task assignments.
 *
 * `tasks` is the original Fleet Console table, given a company_id in 0003 rather
 * than duplicated. `tasks.employee_id` therefore references `profiles(id)`, while
 * the monitor works in `employees`. POST resolves the employee to a profile id
 * before writing; see lib/monitor/fieldTasks.js for why that cannot be skipped.
 */

const LIST_COLUMNS =
  "id, admin_id, employee_id, title, description, target_lat, target_lng, target_address, radius_meters, status, completion_source, due_at, created_at, completed_at";

/** Load an employee inside this company, active or not. */
async function findEmployee(supabase, companyId, employeeId) {
  const { data } = await supabase
    .from("employees")
    .select("id, profile_id, name, emp_code, is_active")
    .eq("id", employeeId)
    .eq("company_id", companyId)
    .maybeSingle();
  return data || null;
}

export async function GET(request) {
  const ctx = await requireContext();
  if (ctx.response) return ctx.response;

  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status");

  let query = ctx.supabase
    .from("tasks")
    .select(LIST_COLUMNS)
    .eq("company_id", ctx.companyId)
    .order("created_at", { ascending: false })
    .limit(500);

  if (status && status !== "all") query = query.eq("status", status);

  const { data, error } = await query;
  if (error) return dbErrorResponse(error, "Could not load tasks");

  // tasks.employee_id is a profile id, so the name is resolved through profiles.
  // The employees table is what the UI shows, so it is joined on profile_id to
  // bring the emp_code along too.
  const profileIds = [...new Set((data || []).map((t) => t.employee_id).filter(Boolean))];
  let people = {};
  if (profileIds.length) {
    const { data: staff } = await ctx.supabase
      .from("employees")
      .select("id, profile_id, name, emp_code")
      .eq("company_id", ctx.companyId)
      .in("profile_id", profileIds);
    people = Object.fromEntries(
      (staff || []).filter((e) => e.profile_id).map((e) => [e.profile_id, { name: e.name, emp_code: e.emp_code, employee_id: e.id }])
    );
  }

  return ok({
    is_admin: ctx.role === "admin",
    rows: (data || []).map((t) => ({
      ...t,
      employee_name: people[t.employee_id]?.name || null,
      employee_code: people[t.employee_id]?.emp_code || null,
    })),
  });
}

export async function POST(request) {
  const ctx = await requireContext({ write: true });
  if (ctx.response) return ctx.response;

  const body = await readJson(request);

  // The assignee is an *employee* id from the UI, resolved to a profile below.
  const employeeId = typeof body?.employee_id === "string" ? body.employee_id.trim() : "";
  if (!employeeId) return badRequest("employee_id is required");

  const { errors, value } = validateTask(body || {});
  if (Object.keys(errors).length > 0) {
    return Response.json({ error: "validation_failed", fields: errors }, { status: 400 });
  }

  // Scoped by company before anything is written, so a task can never be assigned
  // to an employee of another tenant.
  const employee = await findEmployee(ctx.supabase, ctx.companyId, employeeId);
  if (!employee) return notFound("That employee is not in this company");

  const assignee = resolveAssignee(employee);
  if (assignee.error === "employee_inactive") {
    return badRequest(`${employee.name} is not active, so tasks cannot be assigned to them`);
  }
  if (assignee.error === "employee_has_no_profile") {
    // Actionable: they have to be invited to the product before they can hold work.
    return badRequest(`${employee.name} has no login yet. Add them to the product before assigning tasks.`);
  }

  // A pin is optional in the schema but pointless without both halves; the
  // validator already guarantees they arrive together.
  const hasPin = value.has_pin;

  try {
    const { data, error } = await ctx.supabase
      .from("tasks")
      .insert({
        company_id: ctx.companyId,
        admin_id: ctx.user.id,
        employee_id: assignee.profileId,
        title: value.title,
        description: value.description,
        target_lat: hasPin ? value.target_lat : null,
        target_lng: hasPin ? value.target_lng : null,
        target_address: value.target_address,
        radius_meters: value.radius_meters,
        status: "pending",
        due_at: value.due_at,
        completion_source: null,
      })
      .select(LIST_COLUMNS)
      .single();

    if (error) return dbErrorResponse(error, "Could not create that task");

    await writeAudit(ctx.supabase, {
      companyId: ctx.companyId,
      actor: ctx.user,
      action: "task.created",
      entityType: "task",
      entityId: data.id,
      summary: value.title,
      meta: { employee_id: employeeId, has_pin: hasPin, due_at: value.due_at },
    });

    return ok({ row: data }, 201);
  } catch (error) {
    return dbErrorResponse(error, "Could not create that task");
  }
}