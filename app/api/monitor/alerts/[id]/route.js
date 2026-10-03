import { requireContext, badRequest } from "@/lib/server/monitorClient";
import { dbErrorResponse, notFound, ok, readJson, writeAudit } from "@/lib/server/api";
import { updateViolationStatus } from "@/lib/server/alerts";
import { VIOLATION_STATUSES } from "@/lib/monitor/alerts";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/monitor/alerts/[id]
 *
 * Acknowledge or resolve a violation.
 *
 * Admin only, and the transition is validated server-side: `open` cannot jump
 * straight to `resolved`, because that would erase the fact that it sat
 * unattended. A viewer can read the queue but not change it.
 */
export async function PATCH(request, { params }) {
  const ctx = await requireContext({ write: true });
  if (ctx.response) return ctx.response;

  const body = await readJson(request);
  const status = body?.status;

  if (!VIOLATION_STATUSES.includes(status)) {
    return badRequest(`Status must be one of: ${VIOLATION_STATUSES.join(", ")}`);
  }

  try {
    const result = await updateViolationStatus(ctx.supabase, {
      companyId: ctx.companyId,
      id: params.id,
      status,
    });

    if (result.error === "not_found") {
      return notFound("That violation does not exist");
    }

    if (result.error === "invalid_status") {
      return badRequest("Unknown status");
    }

    if (result.error === "invalid_transition") {
      return badRequest(
        `A ${result.from.replace("_", " ")} violation cannot become ${String(result.to).replace("_", " ")}`
      );
    }

    if (result.error === "conflict") {
      return notFound("Someone else updated this violation a moment ago — reload and try again");
    }

    await writeAudit(ctx.supabase, {
      companyId: ctx.companyId,
      actor: ctx.user,
      action: `violation.${status}`,
      entityType: "violation",
      entityId: result.violation.id,
      summary: `Marked a ${result.violation.type} violation as ${status}`,
      meta: {
        employee_id: result.violation.employee_id,
        severity: result.violation.severity,
        occurred_at: result.violation.occurred_at,
        note: typeof body?.note === "string" ? body.note.slice(0, 500) : null,
      },
    });

    return ok({ violation: result.violation });
  } catch (error) {
    return dbErrorResponse(error, "Could not update that violation");
  }
}