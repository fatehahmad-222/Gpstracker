import {
  adminClient,
  badRequest,
  requireContext,
  serverError,
} from "@/lib/server/monitorClient";
import { dbErrorResponse, ok, readJson, writeAudit } from "@/lib/server/api";
import { recordTrackingConsent, resolveLinkedEmployee } from "@/lib/server/mobileApp";

export const dynamic = "force-dynamic";

export async function POST(request) {
  const ctx = await requireContext({ allow: ["employee", "admin"] });
  if (ctx.response) return ctx.response;

  const body = await readJson(request);
  if (typeof body?.consent !== "boolean") {
    return badRequest("consent must be true or false");
  }

  let admin;
  try {
    admin = adminClient();
  } catch {
    return serverError("The mobile API is not configured on this server");
  }

  try {
    const employee = await resolveLinkedEmployee(admin, {
      companyId: ctx.companyId,
      profileId: ctx.profile.id,
    });

    if (!employee) {
      return badRequest("No employee record is linked to your account yet");
    }

    const result = await recordTrackingConsent({
      admin,
      companyId: ctx.companyId,
      employee,
      consent: body.consent,
    });

    await writeAudit(admin, {
      companyId: ctx.companyId,
      actor: ctx.user,
      action: "employee.tracking_consent",
      entityType: "employee",
      entityId: employee.id,
      summary: body.consent ? "Tracking consent granted" : "Tracking consent withdrawn",
      meta: { consent: body.consent, revoked_devices: result.revoked_devices || 0 },
    });

    return ok(result);
  } catch (error) {
    return dbErrorResponse(error, "Could not update tracking consent");
  }
}
