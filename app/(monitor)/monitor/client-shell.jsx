"use client";

import { createContext, useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

import { MonitorSidebar, MonitorTopBar } from "@/components/monitor/shell";
import { canAccessPath } from "@/lib/monitor/nav";
import { MonitorSettingsProvider } from "./settings-context";

/**
 * Client half of the monitor layout: owns the sidebar's open/closed state and
 * provides the monitor context (role, company, settings) to every page.
 *
 * `mon` on the wrapper pins the light palette for this subtree regardless of
 * the app-wide `.dark` class, which is how the module gets its own theme
 * without introducing a second CSS system.
 */

/** Where an employee lands when they reach a staff-only monitor route. */
const EMPLOYEE_HOME = "/monitor/attendance";

export function MonitorClientShell({ children, role, companyCode, timezone, settings, user }) {
  const [navOpen, setNavOpen] = useState(false);
  const pathname = usePathname();
  const router = useRouter();

  const closeNav = useCallback(() => setNavOpen(false), []);
  const toggleNav = useCallback(() => setNavOpen((v) => !v), []);

  /**
   * Role gate for staff-only pages.
   *
   * The sidebar already hides entries an employee may not open, but that only
   * removes the link. Without this, typing the URL rendered the page chrome -
   * `guardMonitorPath` was written for exactly this and never called from
   * anywhere, so the rule only existed as navigation.
   *
   * This is not the security boundary and is not treated as one: every monitor
   * API route independently refuses a non-staff role via requireContext, so no
   * data can reach an employee regardless of what the client renders. What this
   * prevents is showing a staff screen that can only ever fail to load, and it
   * turns the dead guard into an enforced one.
   */
  const permitted = canAccessPath(pathname, role);

  useEffect(() => {
    if (!permitted) router.replace(EMPLOYEE_HOME);
  }, [permitted, router, pathname]);

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
          <main className="min-w-0 flex-1 px-4 py-5 lg:px-6 lg:py-6">
            {/* Held back while a redirect is in flight, so a staff screen never
                flashes for a role that may not have it. */}
            {permitted ? children : null}
          </main>
        </div>
      </div>
    </MonitorSettingsProvider>
  );
}