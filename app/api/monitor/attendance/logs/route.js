import { requireContext } from "@/lib/server/monitorClient";
import { dbErrorResponse, ok } from "@/lib/server/api";
import { listSessionLog, listOpenSessions, attendanceTrend } from "@/lib/server/attendance";

export const dynamic = "force-dynamic";

/**
 * GET /api/monitor/attendance/logs
 *
 * The raw punch log: one row per clock-in, newest first. This is the auditable
 * view a manager disputes against, so it shows what was reported rather than
 * what the rollup concluded.
 *
 * Query: date, department_id, employee_id, out_reason, open (1/0), q, page,
 *        page_size
 */
export async function GET(request) {
  const ctx = await requireContext();
  if (ctx.response) return ctx.response;

  const { searchParams } = new URL(request.url);
  const openParam = searchParams.get("open");

  try {
    const payload = await listSessionLog(ctx.supabase, {
      companyId: ctx.companyId,
      date: searchParams.get("date") || null,
      departmentId: searchParams.get("department_id") || null,
      employeeId: searchParams.get("employee_id") || null,
      outReason: searchParams.get("out_reason") || null,
      open: openParam === null ? null : openParam === "1",
      search: searchParams.get("q") || null,
      page: searchParams.get("page") || 1,
      pageSize: searchParams.get("page_size") || 25,
    });

    // "Still in" is a company-wide question rather than a per-day one: an open
    // session opened yesterday is still someone currently on the clock.
    const openSessions = await listOpenSessions(ctx.supabase, { companyId: ctx.companyId });
    const trend = await attendanceTrend(ctx.supabase, { companyId: ctx.companyId });

    return ok({
      ...payload,
      open_sessions: openSessions,
      open_count: openSessions.length,
      trend: trend.days,
      timezone: ctx.timezone,
    });
  } catch (error) {
    return dbErrorResponse(error, "Could not load the attendance log");
  }
}