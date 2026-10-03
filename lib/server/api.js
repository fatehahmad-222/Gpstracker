import { badRequest, describeDbError } from "./monitorClient";
import { fieldErrors } from "@/lib/monitor/validation";

/**
 * Shared plumbing for the monitor's Route Handlers.
 *
 * Every configuration endpoint follows the same shape, so the repetition lives
 * here rather than in eight near-identical route files: parse the body, run a
 * Zod schema, write an audit row, and translate Postgres errors into
 * something safe to show a user.
 */

/** Read and parse a JSON request body, returning `null` on malformed input. */
export async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

/**
 * Validate a payload against a Zod schema.
 * @returns {{ ok: true, data: object } | { ok: false, response: Response }}
 */
export function validate(schema, payload) {
  if (payload == null) {
    return { ok: false, response: badRequest("Expected a JSON body") };
  }

  const result = schema.safeParse(payload);
  if (!result.success) {
    return {
      ok: false,
      response: badRequest("Please correct the highlighted fields", fieldErrors(result.error)),
    };
  }
  return { ok: true, data: result.data };
}

/** Turn a Supabase error into a Response, or pass a result through as data. */
export function dbErrorResponse(error, fallback) {
  return serverErrorFrom(describeDbError(error, fallback));
}

function serverErrorFrom(message) {
  return Response.json({ error: message || "Something went wrong" }, { status: 500 });
}

/** 404 in the same shape as every other error body. */
export function notFound(message = "Record not found") {
  return Response.json({ error: message }, { status: 404 });
}

/**
 * Record an admin action in `audit_log`.
 *
 * Audit failures must never fail the action the user asked for, so this logs
 * and swallows. It runs with the caller's session, so RLS applies.
 *
 * supabase-js resolves with `{ error }` instead of throwing, so the result has
 * to be inspected — otherwise a rejected insert would look like a success.
 */
export async function writeAudit(supabase, { companyId, actor, action, entityType, entityId, summary, meta }) {
  try {
    const { error } = await supabase.from("audit_log").insert({
      company_id: companyId,
      actor_id: actor?.id ?? null,
      actor_email: actor?.email ?? null,
      action,
      entity_type: entityType,
      entity_id: entityId ?? null,
      summary: summary ?? null,
      meta: meta ?? {},
    });

    if (error) console.error("[monitor] audit_log insert failed", error.message);
  } catch (err) {
    console.error("[monitor] audit_log insert failed", err);
  }
}

/** Standard success body. */
export function ok(data, status = 200) {
  return Response.json(data, { status });
}