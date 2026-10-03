"use client";

import { createContext, useCallback, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

import { MonitorSidebar, MonitorTopBar } from "@/components/monitor/shell";
import { MonitorSettingsProvider } from "./settings-context";

/**
 * Client half of the monitor layout: owns the sidebar's open/closed state and
 * provides the monitor context (role, company, settings) to every page.
 *
 * `mon` on the wrapper pins the light palette for this subtree regardless of
 * the app-wide `.dark` class, which is how the module gets its own theme
 * without introducing a second CSS system.
 */
export function MonitorClientShell({ children, role, companyCode, timezone, settings, user }) {
  const [navOpen, setNavOpen] = useState(false);
  const pathname = usePathname();
  const router = useRouter();

  const closeNav = useCallback(() => setNavOpen(false), []);
  const toggleNav = useCallback(() => setNavOpen((v) => !v), []);

  const signOut = useCallback(async () => {
    try {
      const { createSupabaseBrowserClient } = await import("@/lib/supabaseClient");
      const supabase = createSupabaseBrowserClient();
      await supabase.auth.signOut();
    } catch {
      // Even if the client call fails, send them somewhere that re-checks auth.
    }
    router.replace("/login");
    router.refresh();
  }, [router]);

  const contextValue = useMemo(
    () => ({
      role,
      companyCode,
      timezone,
      settings,
      user,
      isAdmin: role === "admin",
      isStaff: role === "admin" || role === "viewer",
    }),
    [role, companyCode, timezone, settings, user]
  );

  return (
    <MonitorSettingsProvider value={contextValue}>
      <div className="mon flex min-h-screen bg-canvas text-ink">
        <MonitorSidebar
          open={navOpen}
          onClose={closeNav}
          role={role}
          pathname={pathname}
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <MonitorTopBar
            onToggleNav={toggleNav}
            onSignOut={signOut}
            role={role}
            companyCode={companyCode}
            user={user}
          />
          <main className="min-w-0 flex-1 px-4 py-5 lg:px-6 lg:py-6">{children}</main>
        </div>
      </div>
    </MonitorSettingsProvider>
  );
}