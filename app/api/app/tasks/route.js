import { dbErrorResponse, ok } from "@/lib/server/api";
import { requireContext, badRequest } from "@/lib/server/monitorClient";
import { normaliseTaskFilter } from "@/lib/monitor/appTasks";

export const dynamic = "force-dynamic";

const TASK_COLUMNS =
  "id, admin_id, employee_id, title, description, target_lat, target_lng, target_address, radius_meters, status, completion_source, due_at, created_at, completed_at";

/**
 * GET /api/app/tasks
 *
 * An employee's own assigned work. The employee is resolved from the session and
 * the tasks table stores a profile id in `employee_id`, so the identity filter is
 * the one checked here - there is no employee_id parameter to tamper with.
 */
export async function GET(request) {
  const ctx = await requireContext({ allow: ["employee"] });
  if (ctx.response) return ctx.response;

  const { data: employee, error: employeeError } = await ctx.supabase
    .from("employees")
    .select("id, profile_id, status")
    .eq("company_id", ctx.companyId)
    .eq("profile_id", ctx.user.id)
    .is("deleted_at", null)
    .maybeSingle();

  if (employeeError) return dbErrorResponse(employeeError, "Could not load your employee record");
  if (!employee || employee.status !== "active" || !employee.profile_id) {
    return badRequest("No active employee record is linked to your account");
  }

  const { searchParams } = new URL(request.url);
  const filter = normaliseTaskFilter(searchParams.get("status"));

  let query = ctx.supabase
    .from("tasks")
    .select(TASK_COLUMNS)
    .eq("company_id", ctx.companyId)
    .eq("employee_id", ctx.user.id)
    .order("created_at", { ascending: false })
    .limit(200);

  if (filter === "open") query = query.in("status", ["pending", "in_progress"]);
  else if (filter !== "all") query = query.eq("status", filter);

  const { data, error } = await query;
  if (error) return dbErrorResponse(error, "Could not load your tasks");

  return ok({ is_admin: false, rows: data || [], filter });
}
