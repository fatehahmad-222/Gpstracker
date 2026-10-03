"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

const AuthContext = createContext({
  user: null,
  profile: null,
  loading: true,
  refreshProfile: async () => {},
  signOut: async () => {},
});

/**
 * A signed-in user we cannot render anything for. Both cases route to
 * /inactive, which signs the session out — redirecting to /login instead would
 * bounce straight back via middleware and loop. See lib/authGuard.js.
 */
function unusableDestination(profile) {
  if (profile?.is_active === false) return "/inactive?reason=deactivated";
  if (!profile) return "/inactive?reason=missing";
  return null;
}

export function AuthProvider({ children }) {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchProfile = useCallback(async (userId) => {
    if (!userId) {
      setProfile(null);
      return;
    }
    const { data, error } = await supabase
      .from("profiles")
      .select("id, full_name, role, phone, avatar_url, created_at, is_active")
      .eq("id", userId)
      .maybeSingle();

    // A failed query is not the same as a missing row. Bail out without
    // redirecting, or a network blip would sign everyone out.
    if (error) {
      console.error("Profile fetch failed:", error.message);
      return;
    }

    setProfile(data ?? null);

    const destination = unusableDestination(data);
    if (destination) router.replace(destination);
  }, [router]);

  const refreshProfile = useCallback(async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    await fetchProfile(session?.user?.id ?? null);
  }, [fetchProfile]);

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      const activeUser = data.session?.user ?? null;
      setUser(activeUser);
      fetchProfile(activeUser?.id ?? null).finally(() => setLoading(false));
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      const activeUser = session?.user ?? null;
      setUser(activeUser);
      fetchProfile(activeUser?.id ?? null);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [fetchProfile]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    router.replace("/login");
  }, [router]);

  return (
    <AuthContext.Provider value={{ user, profile, loading, refreshProfile, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
