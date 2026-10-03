import { requireContext, badRequest } from "@/lib/server/monitorClient";
import { dbErrorResponse, ok, notFound, readJson, writeAudit } from "@/lib/server/api";
import { validateLeaveRequest } from "@/lib/monitor/leaves";

export const dynamic = "force-dynamic";

/**
 * GET /api/monitor/leaves
 * POST /api/monitor/leaves
 *
 * The leave request queue.
 *
 * Read and write have different audiences on purpose. Listing is staff-only -
 * requireContext's default allow-list refuses an employee, so nobody sees a
 * colleague's request. Filing is open to employees too, because an employee is
 * the one person who legitimately needs to make a request, and 0015's insert
 * policy allows exactly that one case.
 */

const LIST_COLUMNS = "id, employee_id, leave_type, from_date, to_date, status, reason, created_at";

/** Map a signed-in profile to their employee row. */
async function findOwnEmployeeRow(supabase, userId, companyId) {
  const { data } = await supabase
    .from("employees")
    .select("id, emp_code, name")
    .eq("profile_id", userId)
    .eq("company_id", companyId)
    .is("is_active", true)
    .maybeSingle();
  return data || null;
}

export async function GET(request) {
  const ctx = await requireContext();
  if (ctx.response) return ctx.response;

  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status");

  // Scoped by company rather than trusting the caller: RLS would also enforce it,
  // but the query should not depend on that to be correct.
  let query = ctx.supabase
    .from("leaves")
    .select(LIST_COLUMNS)
    .eq("company_id", ctx.companyId)
    .order("from_date", { ascending: false })
    .limit(500);

  if (status && status !== "all") query = query.eq("status", status);

  const { data, error } = await query;
  if (error) return dbErrorResponse(error, "Could not load leave requests");

  // Names are joined in a second pass rather than as an embedded resource: it
  // keeps the select list narrow, and the employees table is staff-only under RLS
  // so an employee caller would get an empty join rather than a name.
  const ids = [...new Set((data || []).map((r) => r.employee_id).filter(Boolean))];
  let names = {};
  if (ids.length) {
    const { data: staff } = await ctx.supabase
      .from("employees")
      .select("id, emp_code, name")
      .in("id", ids);
    names = Object.fromEntries((staff || []).map((e) => [e.id, { name: e.name, emp_code: e.emp_code }]));
  }

  return ok({
    // The client uses this to decide whether to offer approve/reject at all,
    // rather than rendering controls it knows will be refused with a 403.
    is_admin: ctx.role === "admin",
    rows: (data || []).map((r) => ({
      ...r,
      employee_name: names[r.employee_id]?.name || null,
      employee_code: names[r.employee_id]?.emp_code || null,
    })),
  });
}

export async function POST(request) {
  // Employees included: filing your own leave is not an administrative action.
  const ctx = await requireContext({ allow: ["admin", "viewer", "employee"] });
  if (ctx.response) return ctx.response;

  const body = await readJson(request);
  const { errors, value } = validateLeaveRequest(body || {});

  if (Object.keys(errors).length > 0) {
    return Response.json({ error: "validation_failed", fields: errors }, { status: 400 });
  }

  // An employee filing for themselves: resolve their employee row and ignore
  // whatever employee_id arrived in the body. Reading it from the body here is
  // what would let one employee file a request against a colleague's record.
  let employeeId = value.employee_id;
  const filingForSelf = ctx.role === "employee";

  if (filingForSelf) {
    const own = await findOwnEmployeeRow(ctx.supabase, ctx.user.id, ctx.companyId);
    if (!own) {
      return badRequest("Your account is not linked to an active employee record");
    }
    employeeId = own.id;
  } else {
    // Staff filing on someone's behalf: the employee must exist in this company.
    const { data: target } = await ctx.supabase
      .from("employees")
      .select("id")
      .eq("id", employeeId)
      .eq("company_id", ctx.companyId)
      .maybeSingle();
    if (!target) return notFound("That employee is not in this company");
  }

  try {
    const { data, error } = await ctx.supabase
      .from("leaves")
      .insert({
        company_id: ctx.companyId,
        employee_id: employeeId,
        leave_type: value.leave_type,
        from_date: value.from_date,
        to_date: value.to_date,
        reason: value.reason,
        status: "pending",
      })
      .select(LIST_COLUMNS)
      .single();

    if (error) return dbErrorResponse(error, "Could not file that leave request");

    await writeAudit(ctx.supabase, {
      companyId: ctx.companyId,
      actor: ctx.user,
      // Distinguishes a self-service request from one an admin entered by hand.
      action: filingForSelf ? "leave.self_requested" : "leave.requested_on_behalf",
      entityType: "leave",
      entityId: data.id,
      summary: `${value.leave_type} leave ${value.from_date} to ${value.to_date}`,
      meta: { employee_id: employeeId, days: value.days, on_behalf: !filingForSelf },
    });

    return ok({ row: data, days: value.days }, 201);
  } catch (error) {
    return dbErrorResponse(error, "Could not file that leave request");
  }
}