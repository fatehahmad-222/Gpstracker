import { redirect } from "next/navigation";
import { getProfile, getSession } from "@/lib/supabaseServer";

/**
 * SERVER-ONLY module (see the note in lib/supabaseServer.js).
 *
 * Single source of truth for "who is this request?". Every route decides what
 * to do with a request through here, so two call sites can never disagree about
 * where a deactivated or profile-less user belongs.
 *
 * Why this exists: `/dashboard` and `/app` used to each hand-roll their own
 * `is_active` / `role` checks and redirect to `/login` while the session was
 * still valid. middleware.js bounces authenticated users off `/login` back to
 * `/`, so that produced an infinite redirect loop. Likewise a user with no
 * `profiles` row fell through `role !== "admin"` -> `/app` and
 * `role !== "employee"` -> `/dashboard` forever.
 *
 * The fix is to make every terminal outcome a distinct route that is not part
 * of that cycle. `/inactive` is deliberately absent from middleware's matcher,
 * so it can render (and sign the user out) without being redirected away.
 */

export const AUTH_KIND = {
  ANON: "anon",
  DEACTIVATED: "deactivated",
  NO_PROFILE: "no-profile",
  OK: "ok",
};

/** Home route for a signed-in, active profile. */
export function homePathFor(profile) {
  return profile?.role === "admin" ? "/dashboard" : "/app";
}

/**
 * Classify the current request. Never redirects — safe to call from anywhere,
 * including code that wants to branch on the outcome.
 *
 * @returns {Promise<{kind: string, user?: object, profile?: object}>}
 */
export async function resolveAuth() {
  const user = await getSession();
  if (!user) return { kind: AUTH_KIND.ANON };

  const profile = await getProfile();
  if (!profile) return { kind: AUTH_KIND.NO_PROFILE };
  if (profile.is_active === false) return { kind: AUTH_KIND.DEACTIVATED, user, profile };

  return { kind: AUTH_KIND.OK, user, profile };
}

/**
 * Send anon / deactivated / profile-less requests to a terminal route. Returns
 * only for `AUTH_KIND.OK`.
 */
function redirectIfUnusable(auth) {
  if (auth.kind === AUTH_KIND.ANON) redirect("/login");
  if (auth.kind === AUTH_KIND.DEACTIVATED) redirect("/inactive?reason=deactivated");
  if (auth.kind === AUTH_KIND.NO_PROFILE) redirect("/inactive?reason=missing");
}

/** Gate `/` — any signed-in, active user goes to their app. */
export async function requireSignedIn() {
  const auth = await resolveAuth();
  redirectIfUnusable(auth);
  redirect(homePathFor(auth.profile));
}

/**
 * Gate a role-scoped area (`/dashboard` or `/app`).
 *
 * A role mismatch redirects to the *other* app root, which converges: the
 * destination layout's own `requireRole` then matches and renders.
 */
export async function requireRole(role) {
  const auth = await resolveAuth();
  redirectIfUnusable(auth);

  if (auth.profile.role !== role) {
    redirect(homePathFor(auth.profile));
  }

  return auth;
}
