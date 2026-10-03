import { requireContext } from "@/lib/server/monitorClient";
import { dbErrorResponse, ok } from "@/lib/server/api";
import { alertsOverview, listViolations, listDeviceEvents } from "@/lib/server/alerts";

export const dynamic = "force-dynamic";

/**
 * GET /api/monitor/alerts
 *
 * The Alerts & Violation screen (spec 4.5): signal tiles, the triage queue and
 * the raw event log behind it.
 *
 * Query: window_days, status, category, severity, employee_id, q, page,
 *        page_size, events (1 to include the evidence log)
 */
export async function GET(request) {
  const ctx = await requireContext();
  if (ctx.response) return ctx.response;

  const { searchParams } = new URL(request.url);
  const windowDays = Number(searchParams.get("window_days")) || undefined;

  try {
    const overview = await alertsOverview(ctx.supabase, {
      companyId: ctx.companyId,
      windowDays,
      settings: ctx.settings,
    });

    const queue = await listViolations(ctx.supabase, {
      companyId: ctx.companyId,
      windowDays,
      status: searchParams.get("status") || null,
      category: searchParams.get("category") || null,
      severity: searchParams.get("severity") || null,
      employeeId: searchParams.get("employee_id") || null,
      search: searchParams.get("q") || null,
      page: searchParams.get("page") || 1,
      pageSize: searchParams.get("page_size") || 25,
    });

    // The event log is the heavy query, so it is opt-in rather than always
    // fetched for a list nobody has scrolled down to yet.
    const events =
      searchParams.get("events") === "1"
        ? await listDeviceEvents(ctx.supabase, {
            companyId: ctx.companyId,
            windowDays,
            employeeId: searchParams.get("employee_id") || null,
            type: searchParams.get("event_type") || null,
            search: searchParams.get("q") || null,
            limit: searchParams.get("event_limit") || 100,
          })
        : { rows: [], total: 0 };

    return ok({
      ...overview,
      ...queue,
      events: events.rows,
      // `event_total` above is every event in the window; this is how many the
      // evidence log actually returned, which is what the table footer reports.
      events_returned: events.rows.length,
    });
  } catch (error) {
    return dbErrorResponse(error, "Could not load alerts");
  }
}