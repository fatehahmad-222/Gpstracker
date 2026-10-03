import { requireContext } from "@/lib/server/monitorClient";
import { readJson, validate, dbErrorResponse, writeAudit, ok } from "@/lib/server/api";
import {
  ORG_UNITS,
  createSchemaFor,
  listOrgUnits,
  listEmployeesForPicker,
  createOrgUnit,
  describeOrgUnit,
} from "@/lib/server/orgUnits";

export const dynamic = "force-dynamic";

/**
 * GET /api/monitor/org-units?kind=departments
 *
 * One list endpoint for all three configuration tables rather than three
 * identical files. `kind` is validated against a fixed map, never interpolated
 * into SQL, so it cannot be used to reach an arbitrary table.
 *
 * `kind=employees` is also accepted, read-only, so Configuration can fill a
 * scope picker without pulling in Employee Management.
 */
export async function GET(request) {
  const ctx = await requireContext();
  if (ctx.response) return ctx.response;

  const { searchParams } = new URL(request.url);
  const kind = searchParams.get("kind");

  if (kind !== "employees" && !ORG_UNITS[kind]) {
    return Response.json(
      { error: "Unknown configuration type", allowed: [...Object.keys(ORG_UNITS), "employees"] },
      { status: 400 }
    );
  }

  try {
    if (kind === "employees") {
      const rows = await listEmployeesForPicker(ctx.supabase, {
        companyId: ctx.companyId,
        departmentId: searchParams.get("department_id") || null,
        search: searchParams.get("search") || null,
      });
      return ok({ kind, rows });
    }

    const rows = await listOrgUnits(ctx.supabase, {
      kind,
      companyId: ctx.companyId,
      departmentId: searchParams.get("department_id") || null,
      includeInactive: searchParams.get("include_inactive") === "1",
    });

    return ok({ kind, rows });
  } catch (error) {
    return dbErrorResponse(error, `Could not load ${kind === "employees" ? "employees" : ORG_UNITS[kind].plural.toLowerCase()}`);
  }
}

/** POST /api/monitor/org-units — create (or update on a name conflict). */
export async function POST(request) {
  const ctx = await requireContext({ write: true });
  if (ctx.response) return ctx.response;

  const body = await readJson(request);
  const kind = body?.kind;

  if (!ORG_UNITS[kind]) {
    return Response.json({ error: "Unknown configuration type" }, { status: 400 });
  }

  const parsed = validate(createSchemaFor(kind), body.values);
  if (!parsed.ok) return parsed.response;

  try {
    const row = await createOrgUnit(ctx.supabase, {
      kind,
      companyId: ctx.companyId,
      values: parsed.data,
    });

    await writeAudit(ctx.supabase, {
      companyId: ctx.companyId,
      actor: { id: ctx.profile.id, email: ctx.user.email },
      action: "create",
      entityType: kind,
      entityId: row.id,
      summary: `Created ${describeOrgUnit(kind, row)}`,
      meta: parsed.data,
    });

    return ok({ row }, 201);
  } catch (error) {
    return dbErrorResponse(error, `Could not save ${ORG_UNITS[kind].label.toLowerCase()}`);
  }
}