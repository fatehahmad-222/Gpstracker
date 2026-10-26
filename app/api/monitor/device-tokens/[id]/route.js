import { requireContext, badRequest } from "@/lib/server/monitorClient";
import { dbErrorResponse, notFound, ok, readJson, writeAudit } from "@/lib/server/api";
import { allowDeviceReenroll, revokeDeviceToken } from "@/lib/server/ingest";

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

  if (action !== "revoke" && action !== "allow_reenroll") {
    return badRequest('Only "revoke" and "allow_reenroll" are supported');
  }

  try {
    const token =
      action === "revoke"
        ? await revokeDeviceToken(ctx.supabase, {
            companyId: ctx.companyId,
            id: params.id,
          })
        : await allowDeviceReenroll(ctx.supabase, {
            companyId: ctx.companyId,
            id: params.id,
          });

    if (!token) return notFound("No device token with that id");

    await writeAudit(ctx.supabase, {
      companyId: ctx.companyId,
      actor: ctx.user,
      action:
        action === "revoke" ? "device_token.revoked" : "device_token.reenroll_allowed",
      entityType: "device_token",
      entityId: token.id,
      summary:
        action === "revoke"
          ? `Revoked device ${token.device_id}`
          : `Allowed re-enrollment for ${token.device_id}`,
      meta: { employee_id: token.employee_id, device_id: token.device_id },
    });

    return ok({ token });
  } catch (error) {
    return dbErrorResponse(
      error,
      action === "revoke" ? "Could not revoke that device" : "Could not allow re-enrollment"
    );
  }
}