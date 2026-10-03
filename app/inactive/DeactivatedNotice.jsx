"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Ban, Loader2, LogIn, UserRoundX } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { Button } from "@/components/ui/Button";

const COPY = {
  deactivated: {
    icon: Ban,
    title: "Your account is inactive",
    body: "An administrator has deactivated your account, so you can no longer sign in or share your location. Your location history and tasks have been kept. Contact your administrator if you think this is a mistake.",
  },
  missing: {
    icon: UserRoundX,
    title: "We couldn’t load your profile",
    body: "Your sign-in worked, but no profile record is attached to it, so there’s nothing to show you. Sign in again, or ask an administrator to check your account.",
  },
};

/**
 * Terminal route for signed-in users who cannot use the app. It signs the
 * session out on mount so that navigating back to `/` cannot re-enter the
 * redirect cycle described in lib/authGuard.js.
 */
export default function DeactivatedNotice({ reason }) {
  const router = useRouter();
  const [status, setStatus] = useState("signing-out");
  const copy = COPY[reason] ?? COPY.deactivated;
  const Icon = copy.icon;

  useEffect(() => {
    let cancelled = false;

    supabase.auth.signOut().then(
      () => {
        if (!cancelled) setStatus("signed-out");
      },
      () => {
        if (!cancelled) setStatus("failed");
      }
    );

    return () => {
      cancelled = true;
    };
  }, []);

  const retry = useCallback(async () => {
    setStatus("signing-out");
    const { error } = await supabase.auth.signOut();
    if (error) {
      setStatus("failed");
      return;
    }
    router.replace("/login");
  }, [router]);

  const goToLogin = useCallback(async () => {
    setStatus("signing-out");
    // Sign out again before navigating: middleware bounces authenticated users
    // off /login back to /, which would re-enter the cycle we're escaping.
    const { error } = await supabase.auth.signOut();
    if (error) {
      setStatus("failed");
      return;
    }
    router.replace(`/login?reason=${reason === "missing" ? "no-profile" : "deactivated"}`);
  }, [router, reason]);

  return (
    <div className="flex min-h-dvh items-center justify-center bg-bg px-4 py-10">
      <div className="w-full max-w-md rounded-card border border-line bg-surface p-6 text-center shadow-card sm:p-8">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-danger/12 text-danger">
          <Icon size={22} />
        </div>

        <h1 className="font-display text-lg font-semibold text-ink">{copy.title}</h1>
        <p className="mt-2 text-sm text-ink-dim">{copy.body}</p>

        <div className="mt-5 space-y-2">
          {status === "signing-out" && (
            <p className="flex items-center justify-center gap-2 text-sm text-ink-dim">
              <Loader2 size={15} className="animate-spin" />
              Signing you out…
            </p>
          )}

          {status === "failed" && (
            <>
              <p className="text-sm text-danger">
                We couldn’t sign you out automatically.
              </p>
              <Button variant="secondary" className="w-full" onClick={retry}>
                Try again
              </Button>
            </>
          )}

          <Button className="w-full" onClick={goToLogin} disabled={status === "signing-out"}>
            <LogIn size={16} />
            Go to sign in
          </Button>
        </div>
      </div>
    </div>
  );
}
