import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { cookies, headers } from "next/headers";
import { cache } from "react";

import { bearerFromHeader } from "./server/bearer";

function supabaseUrl() {
  return process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder.supabase.co";
}

function supabaseAnonKey() {
  return process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "placeholder-anon-key";
}

function requestAccessToken() {
  try {
    return bearerFromHeader(headers().get("authorization"));
  } catch {
    return null;
  }
}

/**
 * SERVER-ONLY module. Never import from a client component.
 *
 * `cache()` below only resolves because Next aliases the `react` specifier to
 * its own bundled build (createRSCAliases -> next/dist/compiled/react), which
 * exports it; the npm `react` package does not. Pulling this file into the
 * client bundle would break that.
 *
 * Cookie-based Supabase client for Server Components / Route Handlers.
 * Session is read from the request cookies via @supabase/ssr.
 */
export function createSupabaseServerClient() {
  const cookieStore = cookies();

  return createServerClient(supabaseUrl(), supabaseAnonKey(), {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        } catch {
          // `cookies().set` throws outside of a Server Action / Route Handler.
          // Reads still work fine — middleware handles token refresh.
        }
      },
    },
  });
}

export function createSupabaseBearerClient(accessToken) {
  return createClient(supabaseUrl(), supabaseAnonKey(), {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  });
}

export const getServerAuth = cache(async () => {
  const token = requestAccessToken();
  const supabase = token ? createSupabaseBearerClient(token) : createSupabaseServerClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(token || undefined);

  return { supabase, token, user: user ?? null, error: error ?? null };
});

export const getSession = cache(async () => {
  const { user } = await getServerAuth();
  return user;
});

export const getProfile = cache(async () => {
  const { supabase, user } = await getServerAuth();
  if (!user) return null;

  const { data } = await supabase
    .from("profiles")
    .select("id, full_name, role, phone, avatar_url, created_at, is_active")
    .eq("id", user.id)
    .maybeSingle();

  return data ?? null;
});
