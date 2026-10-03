import { requireContext, pageParams } from "@/lib/server/monitorClient";
import { readJson, validate, dbErrorResponse, writeAudit, ok } from "@/lib/server/api";
import { policySchemaFor } from "@/lib/monitor/validation";
import {
  POLICY_TYPES,
  POLICY_SELECT,
  isPolicyType,
  toPolicyRow,
  withScopeLabels,
} from "@/lib/server/policies";

export const dynamic = "force-dynamic";

/** GET /api/monitor/policies */
export async function GET(request) {
  const ctx = await requireContext();
  if (ctx.response) return ctx.response;

  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type");
  const status = searchParams.get("status");
  const { from, to, page, pageSize } = pageParams({
    page: searchParams.get("page"),
    pageSize: searchParams.get("page_size"),
  });

  let query = ctx.supabase
    .from("policies")
    .select(POLICY_SELECT, { count: "exact" })
    .eq("company_id", ctx.companyId)
    .order("created_at", { ascending: false })
    .range(from, to);

  if (isPolicyType(type)) query = query.eq("type", type);
  if (status === "active" || status === "inactive") query = query.eq("status", status);

  const { data, error, count } = await query;
  if (error) return dbErrorResponse(error, "Could not load policies");

  const rows = await withScopeLabels(ctx.supabase, data || [], ctx.companyId);
  return ok({ rows, page, pageSize, total: count ?? rows.length });
}

/** POST /api/monitor/policies */
export async function POST(request) {
  const ctx = await requireContext({ write: true });
  if (ctx.response) return ctx.response;

  const body = await readJson(request);
  const type = body?.type;

  if (!isPolicyType(type)) {
    return Response.json({ error: "Unknown policy type" }, { status: 400 });
  }

  const parsed = validate(policySchemaFor(type), body.values);
  if (!parsed.ok) return parsed.response;

  try {
    const { columnRow, params } = toPolicyRow(parsed.data, type);

    const { data, error } = await ctx.supabase
      .from("policies")
      .insert({ ...columnRow, company_id: ctx.companyId, created_by: ctx.profile.id })
      .select(POLICY_SELECT)
      .single();

    if (error) throw error;

    await writeAudit(ctx.supabase, {
      companyId: ctx.companyId,
      actor: { id: ctx.profile.id, email: ctx.user.email },
      action: "create",
      entityType: "policy",
      entityId: data.id,
      summary: `Created policy "${data.name}"`,
      meta: params,
    });

    return ok({ policy: data }, 201);
  } catch (error) {
    return dbErrorResponse(error, "Could not save this policy");
  }
}