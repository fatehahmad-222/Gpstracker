import { dbErrorResponse, ok } from "@/lib/server/api";
import { requireContext, badRequest } from "@/lib/server/monitorClient";

export const dynamic = "force-dynamic";

const LEAVE_COLUMNS =
  "id, employee_id, leave_type, from_date, to_date, status, reason, created_at";

/**
 * GET /api/app/leaves
 *
 * The employee's own leave history. The staff listing is admin-only, so the app
 * needs this narrowed read to keep "my requests" usable without exposing a
 * colleague's reasons.
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
  if (!employee || employee.status !== "active") {
    return badRequest("No active employee record is linked to your account");
  }

  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status");

  let query = ctx.supabase
    .from("leaves")
    .select(LEAVE_COLUMNS)
    .eq("company_id", ctx.companyId)
    .eq("employee_id", employee.id)
    .order("from_date", { ascending: false })
    .limit(100);

  if (status && status !== "all") query = query.eq("status", status);

  const { data, error } = await query;
  if (error) return dbErrorResponse(error, "Could not load your leave requests");

  return ok({ is_admin: false, rows: data || [] });
}
