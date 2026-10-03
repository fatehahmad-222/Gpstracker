import { requireContext, badRequest } from "@/lib/server/monitorClient";
import { dbErrorResponse, notFound, ok, writeAudit } from "@/lib/server/api";
import { canTransition, isOpen, nextStatuses } from "@/lib/monitor/fieldTasks";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/monitor/tasks/[id]
 *
 * Move a task along its lifecycle.
 *
 * Two transitions are special:
 *
 *   * `completion_source` is set to 'geofence' only when the task actually has a
 *     pin. A task with no location cannot have been completed by arriving, so
 *     claiming geofence for it would be a fabricated provenance record.
 *   * `completed_at` is stamped on completion and cleared if a completed task were
 *     ever reopened, which the transition table forbids - checked here as well so
 *     the two cannot disagree.
 */

const LIST_COLUMNS =
  "id, admin_id, employee_id, title, description, target_lat, target_lng, target_address, radius_meters, status, completion_source, due_at, created_at, completed_at";

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

  const target = typeof body?.status === "string" ? body.status.trim() : "";
  if (!target) return badRequest("status is required");

  const { data: existing, error: readError } = await ctx.supabase
    .from("tasks")
    .select("id, status, title, target_lat, target_lng, employee_id")
    .eq("id", id)
    .eq("company_id", ctx.companyId)
    .maybeSingle();

  if (readError) return dbErrorResponse(readError, "Could not load that task");
  if (!existing) return notFound("No such task");

  if (!canTransition(existing.status, target)) {
    return badRequest(
      isOpen(existing.status)
        ? `A ${existing.status.replace("_", " ")} task cannot become ${target.replace("_", " ")}. Allowed: ${nextStatuses(existing.status).join(", ") || "none"}.`
        : `That task is already ${existing.status.replace("_", " ")} and cannot be changed.`
    );
  }

  const patch = { status: target };

  if (target === "completed") {
    patch.completed_at = new Date().toISOString();
    patch.completion_source = existing.target_lat != null && existing.target_lng != null ? "geofence" : "manual";
  }

  const { data, error } = await ctx.supabase
    .from("tasks")
    .update(patch)
    .eq("id", id)
    .eq("company_id", ctx.companyId)
    .eq("status", existing.status)
    .select(LIST_COLUMNS)
    .maybeSingle();

  if (error) return dbErrorResponse(error, "Could not update that task");

  // status was part of the filter, so no row means a concurrent change won.
  if (!data) return badRequest("That task was changed by someone else just now");

  await writeAudit(ctx.supabase, {
    companyId: ctx.companyId,
    actor: ctx.user,
    action: "task.status_changed",
    entityType: "task",
    entityId: data.id,
    summary: `${data.title}: ${existing.status} → ${target}`,
    meta: {
      employee_id: data.employee_id,
      from_status: existing.status,
      to_status: target,
      completion_source: patch.completion_source ?? null,
    },
  });

  return ok({ row: data });
}