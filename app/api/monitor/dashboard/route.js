import { requireContext } from "@/lib/server/monitorClient";
import { dbErrorResponse, ok } from "@/lib/server/api";
import { dashboardOverview } from "@/lib/server/dashboard";

export const dynamic = "force-dynamic";

/**
 * GET /api/monitor/dashboard
 *
 * The Dashboard card set (spec 4.1).
 *
 * Query: date (company-local YYYY-MM-DD), window_days
 *
 * Read-only, so viewers are allowed — a monitoring dashboard that a viewer
 * cannot open would be a strange thing to build.
 */
export async function GET(request) {
  const ctx = await requireContext();
  if (ctx.response) return ctx.response;

  const { searchParams } = new URL(request.url);

  try {
    const dashboard = await dashboardOverview(ctx.supabase, {
      companyId: ctx.companyId,
      // The company setting, not the hard-coded default: a company whose clock
      // runs on UTC should not have "today" resolved for them in Karachi time.
      timezone: ctx.timezone,
      date: searchParams.get("date") || undefined,
      windowDays: Number(searchParams.get("window_days")) || undefined,
      settings: ctx.settings,
    });

    return ok(dashboard);
  } catch (error) {
    return dbErrorResponse(error, "Could not load the dashboard");
  }
}