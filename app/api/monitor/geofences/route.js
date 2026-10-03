import { requireContext } from "@/lib/server/monitorClient";
import { readJson, validate, dbErrorResponse, writeAudit, ok } from "@/lib/server/api";
import { geofenceSchema } from "@/lib/monitor/validation";
import { listGeofences, createGeofence } from "@/lib/server/geofences";

export const dynamic = "force-dynamic";

/**
 * GET /api/monitor/geofences
 *
 * Also the picker feed: the employee form calls this with a large page size to
 * fill its location multi-select.
 */
export async function GET(request) {
  const ctx = await requireContext();
  if (ctx.response) return ctx.response;

  const { searchParams } = new URL(request.url);

  try {
    const { rows, total } = await listGeofences(ctx.supabase, {
      companyId: ctx.companyId,
      type: searchParams.get("type") || null,
      status: searchParams.get("status") || null,
      search: searchParams.get("q") || null,
    });

    return ok({ rows, total });
  } catch (error) {
    return dbErrorResponse(error, "Could not load geofences");
  }
}

/** POST /api/monitor/geofences */
export async function POST(request) {
  const ctx = await requireContext({ write: true });
  if (ctx.response) return ctx.response;

  const body = await readJson(request);
  const parsed = validate(geofenceSchema, body);
  if (!parsed.ok) return parsed.response;

  try {
    const fence = await createGeofence(ctx.supabase, {
      companyId: ctx.companyId,
      values: parsed.data,
      actorId: ctx.profile.id,
    });

    await writeAudit(ctx.supabase, {
      companyId: ctx.companyId,
      actor: { id: ctx.profile.id, email: ctx.user.email },
      action: "create",
      entityType: "geofence",
      entityId: fence.id,
      summary: `Created ${fence.type} geofence "${fence.name}"`,
      meta: { type: fence.type, radius_m: fence.radius_m, distance_km: fence.distance_km },
    });

    return ok({ geofence: fence }, 201);
  } catch (error) {
    return dbErrorResponse(error, "Could not save this geofence");
  }
}