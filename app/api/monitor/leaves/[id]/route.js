import { requireContext, badRequest } from "@/lib/server/monitorClient";
import { dbErrorResponse, notFound, ok, writeAudit } from "@/lib/server/api";
import { canDecide, nextStatus, countDays } from "@/lib/monitor/leaves";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/monitor/leaves/[id]
 *
 * Approve or reject a request.
 *
 * Write access is required, so this is admin-only - `leaves_update` in the schema
 * agrees. The transition itself is checked here as well as in the shared helper,
 * because a second approval of an already-approved request should be told so
 * plainly rather than reported as a success that changed nothing.
 */

const DECISIONS = { approve: "approved", reject: "rejected" };

export async function PATCH(request, { params }) {
  const ctx = await requireContext({ write: true });
  if (ctx.response) return ctx.response;

  const { id } = params;
  if (!id) return badRequest("id is required");

  let body;
  try {
    body = await request.json();
  } catch {
    return badRequest("Body must be JSON");
  }

  const action = DECISIONS[body?.action];
  if (!action) return badRequest("action must be 'approve' or 'reject'");

  // Read the current row company-scoped rather than trusting the id. Without the
  // company filter this would happily report on another tenant's request id.
  const { data: existing, error: readError } = await ctx.supabase
    .from("leaves")
    .select("id, employee_id, status, from_date, to_date, leave_type")
    .eq("id", id)
    .eq("company_id", ctx.companyId)
    .maybeSingle();

  if (readError) return dbErrorResponse(readError, "Could not load that leave request");
  if (!existing) return notFound("No such leave request");

  if (!canDecide(existing.status)) {
    return badRequest(`That request was already ${existing.status}`);
  }

  const target = nextStatus(existing.status, action);
  if (!target) return badRequest("action must be 'approve' or 'reject'");

  const { data, error } = await ctx.supabase
    .from("leaves")
    .update({ status: target })
    .eq("id", id)
    .eq("company_id", ctx.companyId)
    .eq("status", "pending")
    .select("id, employee_id, leave_type, from_date, to_date, status, reason, created_at")
    .maybeSingle();

  if (error) return dbErrorResponse(error, "Could not record that decision");

  // The status was part of the filter, so no row means someone else decided it
  // between the read and the write. Treat it as a conflict, not a silent success.
  if (!data) return badRequest("That request was decided by someone else just now");

  await writeAudit(ctx.supabase, {
    companyId: ctx.companyId,
    actor: ctx.user,
    action: target === "approved" ? "leave.approved" : "leave.rejected",
    entityType: "leave",
    entityId: data.id,
    summary: `${data.leave_type} leave ${data.from_date} to ${data.to_date}`,
    meta: {
      employee_id: data.employee_id,
      days: countDays(data.from_date, data.to_date),
      from_status: existing.status,
      to_status: target,
    },
  });

  return ok({ row: data });
}