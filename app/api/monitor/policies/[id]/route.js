import { requireContext } from "@/lib/server/monitorClient";
import { readJson, validate, dbErrorResponse, writeAudit, ok, notFound } from "@/lib/server/api";
import { policySchemaFor } from "@/lib/monitor/validation";
import {
  POLICY_SELECT,
  isPolicyType,
  toPolicyRow,
  withScopeLabels,
} from "@/lib/server/policies";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/monitor/policies/[id]
 *
 * The type comes from the request body rather than the stored row so the client
 * validates against the schema it is actually editing.
 */
export async function PATCH(request, { params }) {
  const ctx = await requireContext({ write: true });
  if (ctx.response) return ctx.response;

  const { id } = await params;
  const body = await readJson(request);
  const type = body?.type;

  if (!isPolicyType(type)) {
    return Response.json({ error: "Unknown policy type" }, { status: 400 });
  }

  const parsed = validate(policySchemaFor(type), body.values);
  if (!parsed.ok) return parsed.response;

  try {
    const { columnRow, params } = toPolicyRow(parsed.data, type);

    // Read-modify-write on params: a partial edit must not drop fields the
    // caller did not touch, and merging in JS keeps this out of SQL.
    const { data: existing, error: readError } = await ctx.supabase
      .from("policies")
      .select("params")
      .eq("id", id)
      .eq("company_id", ctx.companyId)
      .maybeSingle();

    if (readError) throw readError;
    if (!existing) return notFound();

    const { data, error } = await ctx.supabase
      .from("policies")
      .update({ ...columnRow, params: { ...(existing.params || {}), ...params } })
      .eq("id", id)
      .eq("company_id", ctx.companyId)
      .select(POLICY_SELECT)
      .maybeSingle();

    if (error) throw error;
    if (!data) return notFound();

    await writeAudit(ctx.supabase, {
      companyId: ctx.companyId,
      actor: { id: ctx.profile.id, email: ctx.user.email },
      action: "update",
      entityType: "policy",
      entityId: id,
      summary: `Updated policy "${data.name}"`,
      meta: params,
    });

    const [row] = await withScopeLabels(ctx.supabase, [data], ctx.companyId);
    return ok({ policy: row });
  } catch (error) {
    return dbErrorResponse(error, "Could not save this policy");
  }
}

/**
 * DELETE /api/monitor/policies/[id]
 *
 * Inactivating is the reversible option the UI offers; this endpoint is for
 * removing a policy that never took effect.
 */
export async function DELETE(request, { params }) {
  const ctx = await requireContext({ write: true });
  if (ctx.response) return ctx.response;

  const { id } = await params;

  try {
    const { data, error } = await ctx.supabase
      .from("policies")
      .delete()
      .eq("id", id)
      .eq("company_id", ctx.companyId)
      .select("id, name")
      .maybeSingle();

    if (error) throw error;
    if (!data) return notFound();

    await writeAudit(ctx.supabase, {
      companyId: ctx.companyId,
      actor: { id: ctx.profile.id, email: ctx.user.email },
      action: "delete",
      entityType: "policy",
      entityId: id,
      summary: `Deleted policy "${data.name}"`,
    });

    return ok({ deleted: true });
  } catch (error) {
    return dbErrorResponse(error, "Could not delete this policy");
  }
}