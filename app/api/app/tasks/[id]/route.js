import { dbErrorResponse, notFound, ok, writeAudit } from "@/lib/server/api";
import { requireContext, badRequest } from "@/lib/server/monitorClient";
import {
  canEmployeeTransition,
  completionSourceFor,
  employeeNextStatuses,
} from "@/lib/monitor/appTasks";

export const dynamic = "force-dynamic";

const TASK_COLUMNS =
  "id, admin_id, employee_id, title, description, target_lat, target_lng, target_address, radius_meters, status, completion_source, due_at, created_at, completed_at";

async function loadOwnTask(supabase, companyId, profileId, id) {
  const { data, error } = await supabase
    .from("tasks")
    .select(TASK_COLUMNS)
    .eq("id", id)
    .eq("company_id", companyId)
    .eq("employee_id", profileId)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

export async function GET(request, { params }) {
  const ctx = await requireContext({ allow: ["employee"] });
  if (ctx.response) return ctx.response;

  try {
    const task = await loadOwnTask(ctx.supabase, ctx.companyId, ctx.user.id, params.id);
    if (!task) return notFound("No such task");
    return ok({ row: task });
  } catch (error) {
    return dbErrorResponse(error, "Could not load that task");
  }
}

export async function PATCH(request, { params }) {
  const ctx = await requireContext({ allow: ["employee"] });
  if (ctx.response) return ctx.response;

  let body;
  try {
    body = await request.json();
  } catch {
    return badRequest("Body must be JSON");
  }

  const target = typeof body?.status === "string" ? body.status.trim() : "";
  if (!target) return badRequest("status is required");

  try {
    const existing = await loadOwnTask(ctx.supabase, ctx.companyId, ctx.user.id, params.id);
    if (!existing) return notFound("No such task");

    if (!canEmployeeTransition(existing.status, target)) {
      return badRequest(
        `You cannot move this task from ${existing.status.replace("_", " ")} to ${target.replace("_", " ")}. Allowed: ${employeeNextStatuses(existing.status).join(", ") || "none"}.`
      );
    }

    const patch = { status: target };
    if (target === "completed") {
      patch.completed_at = new Date().toISOString();
      patch.completion_source = completionSourceFor(target);
    }

    const { data, error } = await ctx.supabase
      .from("tasks")
      .update(patch)
      .eq("id", existing.id)
      .eq("company_id", ctx.companyId)
      .eq("employee_id", ctx.user.id)
      .eq("status", existing.status)
      .select(TASK_COLUMNS)
      .maybeSingle();

    if (error) return dbErrorResponse(error, "Could not update that task");
    if (!data) return badRequest("That task was changed just now. Refresh and try again.");

    await writeAudit(ctx.supabase, {
      companyId: ctx.companyId,
      actor: ctx.user,
      action: "task.employee_status_changed",
      entityType: "task",
      entityId: data.id,
      summary: `${data.title}: ${existing.status} → ${target}`,
      meta: {
        from_status: existing.status,
        to_status: target,
        completion_source: patch.completion_source ?? null,
        source: "mobile",
      },
    });

    return ok({ row: data });
  } catch (error) {
    return dbErrorResponse(error, "Could not update that task");
  }
}
