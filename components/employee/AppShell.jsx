"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, LogOut, Map, Radar } from "lucide-react";
import { useAuth } from "@/components/providers/AuthProvider";
import { useTheme } from "@/components/providers/ThemeProvider";
import { EmployeeTrackerProvider } from "./EmployeeTracker";
import { TrackingStatusPill } from "./TrackingStatus";
import { cn } from "@/lib/utils";

const tabs = [
  { href: "/app", label: "Tasks", icon: Home },
  { href: "/app/map", label: "Map", icon: Map },
];

export default function AppShell({ children }) {
  const pathname = usePathname();
  const { profile, signOut } = useAuth();
  const { theme, toggleTheme } = useTheme();

  return (
    <EmployeeTrackerProvider>
      <div className="mx-auto flex min-h-dvh max-w-lg flex-col bg-bg">
        <header className="sticky top-0 z-40 flex items-center justify-between gap-3 border-b border-line bg-bg/85 px-4 py-3 pt-safe backdrop-blur">
          <Link href="/app" className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-bg">
              <Radar size={16} />
            </div>
            <div className="leading-tight">
              <div className="font-display text-sm font-semibold text-ink">Fleet Console</div>
              <div className="max-w-[140px] truncate text-[11px] text-ink-dim">
                {profile?.full_name || "Employee"}
              </div>
            </div>
          </Link>
          <div className="flex items-center gap-2">
            <TrackingStatusPill />
            <button
              onClick={toggleTheme}
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-line text-ink-dim transition-colors hover:text-ink"
              aria-label="Toggle theme"
            >
              {theme === "dark" ? "☀" : "☾"}
            </button>
            <button
              onClick={signOut}
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-line text-ink-dim transition-colors hover:text-danger"
              aria-label="Sign out"
            >
              <LogOut size={16} />
            </button>
          </div>
        </header>

        <main className="flex-1 px-4 pb-28 pt-4">{children}</main>

        <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 pb-safe backdrop-blur">
          <div className="mx-auto flex max-w-lg">
            {tabs.map((tab) => {
              const active = pathname === tab.href;
              return (
                <Link
                  key={tab.href}
                  href={tab.href}
                  className={cn(
                    "flex flex-1 flex-col items-center gap-1 py-3 text-[11px] font-medium transition-colors",
                    active ? "text-accent" : "text-ink-dim hover:text-ink"
                  )}
                >
                  <tab.icon size={20} strokeWidth={active ? 2.2 : 1.8} />
                  {tab.label}
                  <span
                    className={cn(
                      "h-1 w-1 rounded-full bg-accent transition-opacity",
                      active ? "opacity-100" : "opacity-0"
                    )}
                  />
                </Link>
              );
            })}
          </div>
        </nav>
      </div>
    </EmployeeTrackerProvider>
  );
}
