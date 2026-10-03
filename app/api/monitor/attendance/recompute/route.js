import { requireContext, adminClient, badRequest } from "@/lib/server/monitorClient";
import { dbErrorResponse, ok, readJson, writeAudit } from "@/lib/server/api";
import { toCompanyDate } from "@/lib/monitor/datetime";

export const dynamic = "force-dynamic";

/**
 * POST /api/monitor/attendance/recompute
 *
 * Refreshes `attendance_daily` for one day by calling the SQL job from
 * migration 0010, instead of reimplementing the rollup in JavaScript.
 *
 * The RPC is `service_role` only by design — `attendance_daily` is derived and
 * must not be writable by a browser session. So this handler checks the caller's
 * role *before* building an admin client: the guard runs on the session-scoped
 * client, and only the derivation step itself gets the privileged one.
 *
 * Body: { date } — defaults to today in the company's timezone.
 */
export async function POST(request) {
  const ctx = await requireContext({ write: true });
  if (ctx.response) return ctx.response;

  const body = await readJson(request);
  const date = body?.date || toCompanyDate(new Date(), ctx.timezone);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) {
    return badRequest("Date must look like 2026-09-25");
  }

  try {
    const supabase = adminClient();

    // Close anything left open past the shift end first, otherwise the rollup
    // counts an unclosed session as zero stay time.
    const { error: closeError } = await supabase.rpc("auto_close_sessions", {
      p_company_id: ctx.companyId,
    });
    if (closeError) throw closeError;

    const { data, error } = await supabase.rpc("recompute_attendance_daily", {
      p_company_id: ctx.companyId,
      p_date: date,
    });

    if (error) throw error;

    await writeAudit(ctx.supabase, {
      companyId: ctx.companyId,
      actor: ctx.user,
      action: "attendance.recompute",
      entityType: "attendance_daily",
      entityId: null,
      summary: `Recomputed the attendance rollup for ${date}`,
      meta: { date, rows: data ?? null },
    });

    return ok({ date, rows: data ?? null, sessions_closed: true });
  } catch (error) {
    return dbErrorResponse(error, "Could not recompute attendance");
  }
}