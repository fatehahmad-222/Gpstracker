import { supabase } from "@/lib/supabaseClient";

/** Resolves the correct home route for the signed-in user. */
export async function getHomePath() {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return "/login";

  const { data } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  return data?.role === "admin" ? "/dashboard" : "/app";
}
