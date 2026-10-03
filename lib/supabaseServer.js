import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { cache } from "react";

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

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder.supabase.co",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "placeholder-anon-key",
    {
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
    }
  );
}

export const getSession = cache(async () => {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user ?? null;
});

export const getProfile = cache(async () => {
  const user = await getSession();
  if (!user) return null;

  const supabase = createSupabaseServerClient();
  const { data } = await supabase
    .from("profiles")
    .select("id, full_name, role, phone, avatar_url, created_at, is_active")
    .eq("id", user.id)
    .maybeSingle();

  return data ?? null;
});
