import { z } from "zod";

import { requireContext } from "@/lib/server/monitorClient";
import { readJson, validate, dbErrorResponse, writeAudit, ok, notFound } from "@/lib/server/api";
import { appPasswordSchema } from "@/lib/monitor/validation";
import { createAdminClient } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

/** `appPasswordSchema` validates a bare string, so the body is wrapped here. */
const passwordBodySchema = z.object({ app_password: appPasswordSchema });

/**
 * POST /api/monitor/employees/[id]/password
 *
 * Reset the employee's real sign-in password (the one the web and mobile apps
 * use through Supabase Auth). The legacy `app_password_hash` column is not
 * written: no login path ever checked it.
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
    const { data: employee, error } = await ctx.supabase
      .from("employees")
      .select("id, name, emp_code, profile_id")
      .eq("id", id)
      .eq("company_id", ctx.companyId)
      .maybeSingle();

    if (error) throw error;
    if (!employee) return notFound("Employee not found");

    if (!employee.profile_id) {
      return Response.json(
        { error: "Create a sign-in account for this employee before setting a password." },
        { status: 400 }
      );
    }

    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return Response.json(
        { error: "SUPABASE_SERVICE_ROLE_KEY is not configured on the server." },
        { status: 500 }
      );
    }

    const admin = createAdminClient();
    const { error: updateError } = await admin.auth.admin.updateUserById(employee.profile_id, {
      password: parsed.data.app_password,
    });

    if (updateError) {
      return Response.json(
        { error: updateError.message || "Could not reset this password." },
        { status: 400 }
      );
    }

    await writeAudit(ctx.supabase, {
      companyId: ctx.companyId,
      actor: { id: ctx.profile.id, email: ctx.user.email },
      action: "update",
      entityType: "employee",
      entityId: id,
      summary: `Reset the sign-in password for ${employee.emp_code} (${employee.name})`,
      // Deliberately no password material in the audit trail.
      meta: { signInPasswordReset: true },
    });

    return ok({
      reset: true,
      employee: { id: employee.id, name: employee.name, emp_code: employee.emp_code },
    });
  } catch (error) {
    return dbErrorResponse(error, "Could not reset this password");
  }
}
