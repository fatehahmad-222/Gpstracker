import { requireContext, badRequest } from "@/lib/server/monitorClient";
import { dbErrorResponse, ok, readJson, writeAudit } from "@/lib/server/api";
import { listDeviceTokens, issueDeviceToken } from "@/lib/server/ingest";

export const dynamic = "force-dynamic";

/**
 * GET /api/monitor/device-tokens
 * POST /api/monitor/device-tokens
 *
 * Enrol and list the handsets that may post telemetry.
 *
 * Without this there is nothing for a phone to authenticate as, so it is the
 * administrative front door to ingestion.
 *
 * Never returns a token hash. The plaintext token is shown exactly once, in the
 * POST response, and is unrecoverable afterwards - the same rule as the employee
 * one-time passwords.
 */
export async function GET(request) {
  const ctx = await requireContext({ write: true });
  if (ctx.response) return ctx.response;

  const { searchParams } = new URL(request.url);

  try {
    const rows = await listDeviceTokens(ctx.supabase, {
      companyId: ctx.companyId,
      employeeId: searchParams.get("employee_id") || null,
    });
    return ok({ rows });
  } catch (error) {
    return dbErrorResponse(error, "Could not load device tokens");
  }
}

export async function POST(request) {
  const ctx = await requireContext({ write: true });
  if (ctx.response) return ctx.response;

  const body = await readJson(request);
  const employeeId = body?.employee_id;
  const deviceId = body?.device_id;

  if (!employeeId) return badRequest("employee_id is required");
  if (!deviceId || typeof deviceId !== "string") return badRequest("device_id is required");

  try {
    const result = await issueDeviceToken(ctx.supabase, {
      companyId: ctx.companyId,
      employeeId,
      deviceId,
      label: body?.label || null,
    });

    if (result.error === "missing_device_id") return badRequest("device_id is required");
    if (result.error === "employee_unavailable") {
      return badRequest("That employee is not active, so a device cannot be enrolled for them");
    }

    await writeAudit(ctx.supabase, {
      companyId: ctx.companyId,
      actor: ctx.user,
      action: "device_token.issued",
      entityType: "device_token",
      entityId: result.record?.id,
      summary: `Enrolled device ${deviceId}`,
      // The token itself is never audited. Only the device id, which is not a
      // secret - the credential is the random value the admin already holds.
      meta: { employee_id: employeeId, device_id: deviceId },
    });

    return ok(
      {
        token: result.token,
        record: result.record,
        notice: "Copy this token now. It is not stored and cannot be shown again.",
      },
      201
    );
  } catch (error) {
    return dbErrorResponse(error, "Could not enrol that device");
  }
}