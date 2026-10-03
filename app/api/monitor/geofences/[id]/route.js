import { requireContext } from "@/lib/server/monitorClient";
import { readJson, validate, dbErrorResponse, writeAudit, ok } from "@/lib/server/api";
import { geofenceSchema } from "@/lib/monitor/validation";
import {
  getGeofence,
  listGeofenceEmployees,
  updateGeofence,
  deactivateGeofence,
  deleteGeofence,
} from "@/lib/server/geofences";

export const dynamic = "force-dynamic";

/** GET /api/monitor/geofences/[id] — the fence plus who is assigned to it. */
export async function GET(_request, { params }) {
  const ctx = await requireContext();
  if (ctx.response) return ctx.response;

  try {
    const fence = await getGeofence(ctx.supabase, { companyId: ctx.companyId, id: params.id });
    if (!fence) return ok({ error: "Geofence not found" }, 404);

    const employees = await listGeofenceEmployees(ctx.supabase, {
      companyId: ctx.companyId,
      id: params.id,
    });

    return ok({ geofence: fence, employees });
  } catch (error) {
    return dbErrorResponse(error, "Could not load this geofence");
  }
}

/** PATCH /api/monitor/geofences/[id] */
export async function PATCH(request, { params }) {
  const ctx = await requireContext({ write: true });
  if (ctx.response) return ctx.response;

  const body = await readJson(request);
  // Validated as a whole fence, not a merge: changing a fence's type changes
  // which columns are meaningful, so a partial patch of the wrong shape would
  // leave the geometry and its derived columns disagreeing.
  const parsed = validate(geofenceSchema, body);
  if (!parsed.ok) return parsed.response;

  try {
    const fence = await updateGeofence(ctx.supabase, {
      companyId: ctx.companyId,
      id: params.id,
      values: parsed.data,
    });
    if (!fence) return ok({ error: "Geofence not found" }, 404);

    await writeAudit(ctx.supabase, {
      companyId: ctx.companyId,
      actor: { id: ctx.profile.id, email: ctx.user.email },
      action: "update",
      entityType: "geofence",
      entityId: fence.id,
      summary: `Updated ${fence.type} geofence "${fence.name}"`,
      meta: { type: fence.type, status: fence.status },
    });

    return ok({ geofence: fence });
  } catch (error) {
    return dbErrorResponse(error, "Could not update this geofence");
  }
}

/**
 * DELETE /api/monitor/geofences/[id]
 *
 * `?mode=deactivate` retires the fence without deleting it; that is the default,
 * and the honest choice for anything a device may already have cached. A hard
 * delete is only offered for a fence nobody is assigned to.
 */
export async function DELETE(request, { params }) {
  const ctx = await requireContext({ write: true });
  if (ctx.response) return ctx.response;

  const { searchParams } = new URL(request.url);
  const mode = searchParams.get("mode") === "delete" ? "delete" : "deactivate";

  try {
    if (mode === "delete") {
      const { deleted, assigned } = await deleteGeofence(ctx.supabase, {
        companyId: ctx.companyId,
        id: params.id,
      });

      if (!deleted) return ok({ error: "Geofence not found" }, 404);

      await writeAudit(ctx.supabase, {
        companyId: ctx.companyId,
        actor: { id: ctx.profile.id, email: ctx.user.email },
        action: "delete",
        entityType: "geofence",
        entityId: deleted.id,
        summary: `Deleted geofence "${deleted.name}"`,
        meta: { assigned },
      });

      return ok({ deleted, assigned });
    }

    const fence = await deactivateGeofence(ctx.supabase, {
      companyId: ctx.companyId,
      id: params.id,
    });
    if (!fence) return ok({ error: "Geofence not found" }, 404);

    await writeAudit(ctx.supabase, {
      companyId: ctx.companyId,
      actor: { id: ctx.profile.id, email: ctx.user.email },
      action: "update",
      entityType: "geofence",
      entityId: fence.id,
      summary: `Deactivated geofence "${fence.name}"`,
    });

    return ok({ geofence: fence });
  } catch (error) {
    return dbErrorResponse(error, "Could not remove this geofence");
  }
}