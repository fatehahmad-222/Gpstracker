import { requireContext, badRequest } from "@/lib/server/monitorClient";
import { dbErrorResponse, notFound, ok, readJson, writeAudit } from "@/lib/server/api";
import { revokeDeviceToken } from "@/lib/server/ingest";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/monitor/device-tokens/[id]
 *
 * Revoke an enrolled handset.
 *
 * This is the "we lost the phone" path, so it takes effect immediately: the next
 * ingest from that device is rejected with the same 401 as an unknown token,
 * which means a lost handset cannot keep reporting somebody's location.
 *
 * Revoking does not delete the row. The history of which device was enrolled
 * when is worth keeping for an investigation, and `device_profiles` still refers
 * to it.
 */
export async function PATCH(request, { params }) {
  const ctx = await requireContext({ write: true });
  if (ctx.response) return ctx.response;

  const body = await readJson(request);
  const action = body?.action;

  if (action !== "revoke") {
    return badRequest('Only "revoke" is supported');
  }

  try {
    const token = await revokeDeviceToken(ctx.supabase, {
      companyId: ctx.companyId,
      id: params.id,
    });

    // Already revoked, or belonging to another company. Treated as not-found
    // rather than forbidden so this cannot confirm that someone else's token id
    // exists.
    if (!token) return notFound("No active token with that id");

    await writeAudit(ctx.supabase, {
      companyId: ctx.companyId,
      actor: ctx.user,
      action: "device_token.revoked",
      entityType: "device_token",
      entityId: token.id,
      summary: `Revoked device ${token.device_id}`,
      meta: { employee_id: token.employee_id, device_id: token.device_id },
    });

    return ok({ token });
  } catch (error) {
    return dbErrorResponse(error, "Could not revoke that device");
  }
}