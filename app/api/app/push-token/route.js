import { adminClient, badRequest, requireContext, serverError } from "@/lib/server/monitorClient";
import { dbErrorResponse, ok, readJson } from "@/lib/server/api";
import {
  registerPushToken,
  resolveLinkedEmployee,
  unregisterPushToken,
} from "@/lib/server/mobileApp";

export const dynamic = "force-dynamic";

export async function POST(request) {
  const ctx = await requireContext({ allow: ["employee", "admin", "viewer"] });
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

    const result = await registerPushToken({
      admin,
      companyId: ctx.companyId,
      profileId: ctx.profile.id,
      employee,
      body,
    });

    if (result.error === "invalid_push_token") {
      return badRequest("A valid Expo push token is required");
    }
    if (result.error) return badRequest("Could not register this push token");

    return ok({ registered: true, record: result.record });
  } catch (error) {
    return dbErrorResponse(error, "Could not register this push token");
  }
}

export async function DELETE(request) {
  const ctx = await requireContext({ allow: ["employee", "admin", "viewer"] });
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
    const result = await unregisterPushToken({
      admin,
      profileId: ctx.profile.id,
      body,
    });

    if (result.error === "invalid_push_token") {
      return badRequest("A valid Expo push token is required");
    }
    if (result.error) return badRequest("Could not remove this push token");

    return ok(result);
  } catch (error) {
    return dbErrorResponse(error, "Could not remove this push token");
  }
}
