import { createClient } from "@supabase/supabase-js";

/**
 * Service-role Supabase client for server-only code (Route Handlers).
 * Bypasses RLS — never import this from client components.
 * The key is intentionally NOT NEXT_PUBLIC_ prefixed.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  return createClient(url, serviceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
