import { requireContext, badRequest } from "@/lib/server/monitorClient";
import { dbErrorResponse, notFound, ok, readJson, writeAudit } from "@/lib/server/api";
import { findOpenSession, closeSessionManually } from "@/lib/server/attendance";
import { toCompanyDate } from "@/lib/monitor/datetime";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/monitor/attendance/sessions/[id]
 *
 * An administrator closing an open session by hand — the phone died mid-shift,
 * so nobody ever sent a clock-out.
 *
 * Admin only: this edits worked hours, which is a payroll input. Deliberately
 * refuses to touch a session that already has a clock-out, because silently
 * rewriting a finished session is not something an attendance screen should be
 * able to do.
 */
export async function PATCH(request, { params }) {
  const ctx = await requireContext({ write: true });
  if (ctx.response) return ctx.response;

  const body = await readJson(request);
  const stamp = body?.clock_out_at;

  if (stamp != null && Number.isNaN(new Date(stamp).getTime())) {
    return badRequest("That is not a valid timestamp");
  }

  try {
    // Read first: a session cannot end before it began, and rejecting that
    // after the update would leave a corrupt row behind.
    const open = await findOpenSession(ctx.supabase, {
      companyId: ctx.companyId,
      sessionId: params.id,
    });

    if (!open) {
      return notFound("That session is already closed, or does not exist");
    }

    const clockOutAt = stamp ? new Date(stamp).toISOString() : new Date().toISOString();

    if (new Date(clockOutAt) < new Date(open.clock_in_at)) {
      return badRequest("A session cannot end before it started");
    }

    const session = await closeSessionManually(ctx.supabase, {
      companyId: ctx.companyId,
      sessionId: open.id,
      clockOutAt,
    });

    // Lost a race with a concurrent close; nothing was corrupted.
    if (!session) {
      return notFound("That session was closed by someone else a moment ago");
    }

    await writeAudit(ctx.supabase, {
      companyId: ctx.companyId,
      actor: ctx.user,
      action: "attendance.session.manual_close",
      entityType: "attendance_session",
      entityId: session.id,
      summary: "Closed an open attendance session manually",
      meta: {
        employee_id: session.employee_id,
        clock_in_at: session.clock_in_at,
        clock_out_at: session.clock_out_at,
        recompute_date: toCompanyDate(session.clock_out_at, ctx.timezone),
      },
    });

    return ok({ session });
  } catch (error) {
    return dbErrorResponse(error, "Could not close that session");
  }
}