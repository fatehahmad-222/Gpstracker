import { dbErrorResponse, ok } from "@/lib/server/api";
import { adminClient, requireContext, serverError } from "@/lib/server/monitorClient";
import { buildBootstrap } from "@/lib/server/mobileApp";

export const dynamic = "force-dynamic";

export async function GET() {
  const ctx = await requireContext({ allow: ["employee", "admin", "viewer"] });
  if (ctx.response) return ctx.response;

  let admin;
  try {
    admin = adminClient();
  } catch {
    return serverError("The mobile API is not configured on this server");
  }

  try {
    const data = await buildBootstrap({
      admin,
      companyId: ctx.companyId,
      profileId: ctx.profile.id,
      role: ctx.role,
      settings: ctx.settings,
      timezone: ctx.timezone,
    });

    return ok(data);
  } catch (error) {
    return dbErrorResponse(error, "Could not load app bootstrap");
  }
}
