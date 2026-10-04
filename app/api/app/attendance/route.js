import { requireContext, badRequest } from "@/lib/server/monitorClient";
import { dbErrorResponse, ok } from "@/lib/server/api";
import { listSessionLog } from "@/lib/server/attendance";

export const dynamic = "force-dynamic";

/**
 * GET /api/app/attendance?date=yyyy-mm-dd
 *
 * The employee's *own* attendance. This exists because /dashboard/attendance is
 * an admin rollup, and the field app used to have no working attendance view at
 * all: the old page fetched that admin endpoint, which 403s on `requireContext`
 * for employees.
 *
 * The employee is resolved from the session, never from the query string, so
 * there is no `employee_id` parameter to tamper with. Everything below is
 * therefore pinned to one person by construction.
 */
export async function GET(request) {
  const ctx = await requireContext({ allow: ["employee", "admin", "viewer"] });
  if (ctx.response) return ctx.response;

  const { searchParams } = new URL(request.url);

  try {
    // Resolve the caller's HR record. `employees.profile_id` is nullable, so an
    // employee without one is a real (if odd) state rather than an error to hide.
    const { data: linked, error: linkError } = await ctx.supabase
      .from("employees")
      .select("id, name, emp_code")
      .eq("company_id", ctx.companyId)
      .eq("profile_id", ctx.user.id)
      .limit(1);

    if (linkError) throw linkError;

    const me = linked?.[0] || null;
    if (!me) {
      return badRequest("No employee record is linked to your account yet");
    }

    const date = searchParams.get("date") || null;
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return badRequest("date must be yyyy-mm-dd");
    }

    const log = await listSessionLog(ctx.supabase, {
      companyId: ctx.companyId,
      employeeId: me.id,
      date,
      page: searchParams.get("page") || 1,
      pageSize: 50,
    });

    // The live "still clocked in" card. Deliberately not date-scoped: a shift
    // that started yesterday and is still open is still open now.
    const { data: openRows, error: openError } = await ctx.supabase
      .from("attendance_sessions")
      .select("id, clock_in_at, out_reason, source")
      .eq("company_id", ctx.companyId)
      .eq("employee_id", me.id)
      .is("clock_out_at", null)
      .limit(1);

    if (openError) throw openError;

    return ok({
      date: log.date,
      timezone: ctx.timezone,
      employee: { id: me.id, name: me.name, emp_code: me.emp_code },
      rows: log.rows,
      open_session: openRows?.[0] || null,
      is_open: Boolean(openRows?.length),
    });
  } catch (error) {
    return dbErrorResponse(error, "Could not load your attendance");
  }
}