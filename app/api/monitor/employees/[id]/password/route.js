import { requireContext } from "@/lib/server/monitorClient";
import { readJson, validate, dbErrorResponse, writeAudit, ok, notFound } from "@/lib/server/api";
import { z } from "zod";
import { appPasswordSchema } from "@/lib/monitor/validation";
import { setAppPassword } from "@/lib/server/employees";

export const dynamic = "force-dynamic";

/** `appPasswordSchema` validates a bare string, so the body is wrapped here. */
const passwordBodySchema = z.object({ app_password: appPasswordSchema });

/**
 * POST /api/monitor/employees/[id]/password
 *
 * Separate from the general PATCH so resetting a password is its own audited
 * action with its own permission surface.
 */
export async function POST(request, { params }) {
  const ctx = await requireContext({ write: true });
  if (ctx.response) return ctx.response;

  const { id } = await params;
  const parsed = validate(passwordBodySchema, await readJson(request));
  if (!parsed.ok) return parsed.response;

  try {
    const row = await setAppPassword(ctx.supabase, {
      companyId: ctx.companyId,
      id,
      password: parsed.data.app_password,
    });

    if (!row) return notFound("Employee not found");

    await writeAudit(ctx.supabase, {
      companyId: ctx.companyId,
      actor: { id: ctx.profile.id, email: ctx.user.email },
      action: "update",
      entityType: "employee",
      entityId: id,
      summary: `Reset the app password for ${row.emp_code} (${row.name})`,
      // Deliberately no password material in the audit trail.
      meta: { appPasswordReset: true },
    });

    return ok({ reset: true, employee: row });
  } catch (error) {
    return dbErrorResponse(error, "Could not reset this password");
  }
}