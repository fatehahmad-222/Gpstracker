import { createSupabaseServerClient } from "../supabaseServer";
import { createAdminClient } from "../supabaseAdmin";

/**
 * SERVER-ONLY helpers for the monitor module.
 *
 * Two clients, and the difference matters:
 *   - `createSupabaseServerClient()` — carries the caller's session, so RLS
 *     applies. Use this for every user-facing read/write. Cross-tenant reads
 *     are impossible even if a query forgets a company filter.
 *   - `createAdminClient()`          — service role, RLS BYPASSED. Only for
 *     ingestion, derivation jobs and the seed script. Never for a page.
 */

export const DEFAULT_COMPANY_ID = "c0000000-0000-4000-8000-000000000001";

export function defaultCompanyCode() {
  return process.env.NEXT_PUBLIC_DEMO_COMPANY_CODE || "PK-PUN-SKT-MX05";
}

/**
 * Resolve the caller's session, profile and company in one pass.
 * Cached per request by `react.cache` inside supabaseServer where possible.
 */
export async function getMonitorContext() {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { supabase, user: null, profile: null, company: null, settings: {}, role: null };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, full_name, role, phone, avatar_url, company_id, is_active")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile) {
    return { supabase, user, profile: null, company: null, settings: {}, role: null };
  }

  const companyId = profile.company_id || DEFAULT_COMPANY_ID;

  const { data: company } = await supabase
    .from("companies")
    .select("id, name, company_code, timezone, settings")
    .eq("id", companyId)
    .maybeSingle();

  return {
    supabase,
    user,
    profile,
    company,
    companyId,
    settings: company?.settings || {},
    role: profile.role,
    timezone: company?.timezone || "Asia/Karachi",
  };
}

/**
 * Guard for Route Handlers. Returns a 401/403 Response when the caller is not
 * allowed, otherwise `{ supabase, companyId, role }`.
 */
export async function requireContext({ allow = ["admin", "viewer"], write = false } = {}) {
  const ctx = await getMonitorContext();

  if (!ctx.user) {
    return { response: unauthorized("Sign in required") };
  }
  if (!ctx.profile) {
    return { response: unauthorized("No profile for this account") };
  }
  if (ctx.profile.is_active === false) {
    return { response: forbidden("This account has been deactivated") };
  }
  if (!allow.includes(ctx.role)) {
    return { response: forbidden(`Requires role: ${allow.join(" or ")}`) };
  }
  if (write && ctx.role !== "admin") {
    return { response: forbidden("This action requires an administrator") };
  }

  return {
    supabase: ctx.supabase,
    companyId: ctx.companyId,
    settings: ctx.settings,
    timezone: ctx.timezone,
    role: ctx.role,
    profile: ctx.profile,
    user: ctx.user,
  };
}

/** Service-role client for jobs and ingestion. Bypasses RLS. */
export function adminClient() {
  return createAdminClient();
}

export function unauthorized(message = "Unauthorized") {
  return Response.json({ error: message }, { status: 401 });
}

export function forbidden(message = "Forbidden") {
  return Response.json({ error: message }, { status: 403 });
}

export function badRequest(message = "Bad request", fields = null) {
  return Response.json({ error: message, fields }, { status: 400 });
}

export function serverError(message = "Something went wrong") {
  return Response.json({ error: message }, { status: 500 });
}

/**
 * Uniform error text for a Supabase result, so route handlers never leak a raw
 * Postgres constraint name or stack detail to the browser.
 */
export function describeDbError(error, fallback = "Database error") {
  if (!error) return null;
  const message = String(error.message || "");
  if (/row-level security/i.test(message)) {
    return "You do not have permission to perform this action.";
  }
  if (/duplicate key|unique constraint/i.test(message)) {
    return "That record already exists.";
  }
  if (/violates (not-null|check) constraint/i.test(message)) {
    return "A required or invalid field was rejected.";
  }
  return process.env.NODE_ENV === "development" ? `${fallback}: ${message}` : fallback;
}

/**
 * Cap a Supabase select at the PostgREST row limit.
 * Every list query is paginated, but the cap is a belt-and-braces guard
 * against a wide join blowing up the response.
 */
export const MAX_PAGE_SIZE = 200;

export function pageParams({ page = 1, pageSize = 25 } = {}) {
  const size = Math.min(Math.max(1, Number(pageSize) || 25), MAX_PAGE_SIZE);
  const current = Math.max(1, Number(page) || 1);
  return { from: (current - 1) * size, to: current * size - 1, page: current, pageSize: size };
}