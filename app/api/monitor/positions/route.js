import { requireContext } from "@/lib/server/monitorClient";
import { dbErrorResponse, ok } from "@/lib/server/api";
import { listPositions, annotateWithFences } from "@/lib/server/positions";

export const dynamic = "force-dynamic";

/**
 * GET /api/monitor/positions
 *
 * The live map's poll target. Returns the latest fix per employee plus whether
 * they are currently inside one of their assigned fences.
 */
export async function GET(request) {
  const ctx = await requireContext();
  if (ctx.response) return ctx.response;

  const { searchParams } = new URL(request.url);

  try {
    const positions = await listPositions(ctx.supabase, {
      companyId: ctx.companyId,
      departmentId: searchParams.get("department_id") || null,
    });

    const rows = await annotateWithFences(ctx.supabase, {
      companyId: ctx.companyId,
      positions,
    });

    return ok({
      rows,
      total: rows.length,
      // Sent so the client can label the age of what it is looking at without
      // trusting its own clock.
      served_at: new Date().toISOString(),
    });
  } catch (error) {
    return dbErrorResponse(error, "Could not load live positions");
  }
}