import { requireContext } from "@/lib/server/monitorClient";
import { readJson, validate, dbErrorResponse, writeAudit, ok, notFound } from "@/lib/server/api";
import {
  ORG_UNITS,
  patchSchemaFor,
  updateOrgUnit,
  deleteOrgUnit,
  describeOrgUnit,
} from "@/lib/server/orgUnits";

export const dynamic = "force-dynamic";

/** PATCH /api/monitor/org-units/[kind]/[id] */
export async function PATCH(request, { params }) {
  const ctx = await requireContext({ write: true });
  if (ctx.response) return ctx.response;

  const { kind, id } = await params;
  if (!ORG_UNITS[kind]) {
    return Response.json({ error: "Unknown configuration type" }, { status: 400 });
  }

  const parsed = validate(patchSchemaFor(kind), await readJson(request));
  if (!parsed.ok) return parsed.response;

  try {
    const row = await updateOrgUnit(ctx.supabase, {
      kind,
      companyId: ctx.companyId,
      id,
      values: parsed.data,
    });

    if (!row) return notFound();

    await writeAudit(ctx.supabase, {
      companyId: ctx.companyId,
      actor: { id: ctx.profile.id, email: ctx.user.email },
      action: "update",
      entityType: kind,
      entityId: id,
      summary: `Updated ${describeOrgUnit(kind, row)}`,
      meta: parsed.data,
    });

    return ok({ row });
  } catch (error) {
    return dbErrorResponse(error, `Could not save ${ORG_UNITS[kind].label.toLowerCase()}`);
  }
}

/**
 * DELETE /api/monitor/org-units/[kind]/[id]
 *
 * Archives rather than deletes when employees still reference the record, and
 * says so in the response so the UI can explain what happened.
 */
export async function DELETE(request, { params }) {
  const ctx = await requireContext({ write: true });
  if (ctx.response) return ctx.response;

  const { kind, id } = await params;
  if (!ORG_UNITS[kind]) {
    return Response.json({ error: "Unknown configuration type" }, { status: 400 });
  }

  try {
    const result = await deleteOrgUnit(ctx.supabase, { kind, companyId: ctx.companyId, id });

    await writeAudit(ctx.supabase, {
      companyId: ctx.companyId,
      actor: { id: ctx.profile.id, email: ctx.user.email },
      action: result.archived ? "archive" : "delete",
      entityType: kind,
      entityId: id,
      summary: result.archived
        ? `Archived ${ORG_UNITS[kind].label.toLowerCase()} with ${result.employeeCount} employee(s) still assigned`
        : `Deleted ${ORG_UNITS[kind].label.toLowerCase()}`,
      meta: { employeeCount: result.employeeCount },
    });

    return ok(result);
  } catch (error) {
    return dbErrorResponse(error, `Could not remove ${ORG_UNITS[kind].label.toLowerCase()}`);
  }
}