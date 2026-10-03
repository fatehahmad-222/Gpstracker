import { requireContext } from "@/lib/server/monitorClient";
import { dbErrorResponse, ok } from "@/lib/server/api";
import { attendanceOverview } from "@/lib/server/attendance";

export const dynamic = "force-dynamic";

/**
 * GET /api/monitor/attendance
 *
 * One company-local day's attendance, derived live from the punch log so the
 * page reflects people who have clocked in since the last scheduled rollup.
 *
 * Query: date (yyyy-mm-dd), department_id, status, q, include_archived
 */
export async function GET(request) {
  const ctx = await requireContext();
  if (ctx.response) return ctx.response;

  const { searchParams } = new URL(request.url);

  try {
    const payload = await attendanceOverview(ctx.supabase, {
      companyId: ctx.companyId,
      date: searchParams.get("date") || null,
      departmentId: searchParams.get("department_id") || null,
      status: searchParams.get("status") || null,
      search: searchParams.get("q") || null,
      includeArchived: searchParams.get("include_archived") === "1",
    });

    return ok({ ...payload, timezone: ctx.timezone });
  } catch (error) {
    return dbErrorResponse(error, "Could not load attendance");
  }
}