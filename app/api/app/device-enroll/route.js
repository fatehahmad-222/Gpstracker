import {
  adminClient,
  badRequest,
  forbidden,
  requireContext,
  serverError,
} from "@/lib/server/monitorClient";
import { dbErrorResponse, ok, readJson, writeAudit } from "@/lib/server/api";
import { enrollDevice, resolveLinkedEmployee } from "@/lib/server/mobileApp";

export const dynamic = "force-dynamic";

export async function POST(request) {
  const ctx = await requireContext({ allow: ["employee", "admin"] });
  if (ctx.response) return ctx.response;

  const body = await readJson(request);
  if (!body) return badRequest("Expected a JSON body");

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
      return badRequest("No active employee record is linked to your account yet");
    }

    const result = await enrollDevice({
      admin,
      userClient: ctx.supabase,
      companyId: ctx.companyId,
      employee,
      body,
    });

    if (result.error === "missing_device_id") {
      return badRequest("device_id is required");
    }
    if (result.error === "employee_unavailable") {
      return badRequest("Your employee record is not active");
    }
    if (result.error === "rate_limited") {
      return Response.json(
        { error: "Too many enrollment attempts. Try again tomorrow." },
        { status: 429 }
      );
    }
    if (result.error === "reenroll_not_allowed") {
      return forbidden("Administrator approval is required to enroll this device again");
    }
    if (result.error) {
      return badRequest("Could not enroll this device");
    }

    await writeAudit(admin, {
      companyId: ctx.companyId,
      actor: ctx.user,
      action: "device_token.self_enrolled",
      entityType: "device_token",
      entityId: result.record?.id,
      summary: `Employee enrolled device ${body.device_id}`,
      meta: {
        employee_id: employee.id,
        device_id: body.device_id,
        install_id: body?.device?.install_id ?? body?.install_id ?? null,
      },
    });

    return ok(
      {
        token: result.token,
        record: result.record,
        employee: result.employee,
        notice: "Store this token securely. It is not shown again.",
      },
      201
    );
  } catch (error) {
    return dbErrorResponse(error, "Could not enroll this device");
  }
}
