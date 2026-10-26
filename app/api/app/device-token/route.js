import { adminClient, badRequest, requireContext, serverError } from "@/lib/server/monitorClient";
import { dbErrorResponse, ok, readJson, writeAudit } from "@/lib/server/api";
import { resolveLinkedEmployee, unenrollDevice } from "@/lib/server/mobileApp";

export const dynamic = "force-dynamic";

export async function DELETE(request) {
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

    const result = await unenrollDevice({
      admin,
      companyId: ctx.companyId,
      employee,
      body,
    });

    if (result.error === "missing_device_id") {
      return badRequest("device_id is required");
    }
    if (result.error) {
      return badRequest("Could not remove this device");
    }

    if (result.revoked) {
      await writeAudit(admin, {
        companyId: ctx.companyId,
        actor: ctx.user,
        action: "device_token.self_revoked",
        entityType: "device_token",
        summary: `Employee removed device ${result.device_id}`,
        meta: { employee_id: employee.id, device_id: result.device_id },
      });
    }

    return ok(result);
  } catch (error) {
    return dbErrorResponse(error, "Could not remove this device");
  }
}
