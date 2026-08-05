"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { KanbanSquare, LayoutDashboard, LogOut, Radar, Users } from "lucide-react";
import { useAuth } from "@/components/providers/AuthProvider";
import { useTheme } from "@/components/providers/ThemeProvider";
import { useRealtimeStatus } from "@/hooks/useRealtimeStatus";
import RealtimeBadge from "./RealtimeBadge";
import { cn } from "@/lib/utils";

const nav = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { href: "/dashboard/tasks", label: "Tasks", icon: KanbanSquare },
  { href: "/dashboard/employees", label: "Employees", icon: Users },
];

export default function AdminShell({ children }) {
  const pathname = usePathname();
  const { profile, signOut } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const connection = useRealtimeStatus();

  return (
    <div className="flex min-h-dvh bg-bg">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-line bg-surface md:flex">
        <Link href="/dashboard" className="flex items-center gap-2.5 px-5 py-5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent text-bg shadow-glow">
            <Radar size={18} />
          </div>
          <div className="leading-tight">
            <div className="font-display text-sm font-semibold text-ink">Fleet Console</div>
            <div className="text-[11px] text-ink-dim">Admin</div>
          </div>
        </Link>

        <nav className="flex-1 space-y-1 px-3">
          {nav.map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 rounded-field px-3 py-2.5 text-sm font-medium transition-colors",
                  active
                    ? "bg-accent/10 text-accent"
                    : "text-ink-dim hover:bg-surface-2 hover:text-ink"
                )}
              >
                <item.icon size={18} strokeWidth={active ? 2.2 : 1.8} />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-line p-3">
          <RealtimeBadge status={connection} />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-40 flex items-center justify-between gap-3 border-b border-line bg-bg/85 px-4 py-3 backdrop-blur md:px-6">
          <nav className="flex items-center gap-1 md:hidden">
            <Link href="/dashboard" className="mr-1 flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-bg">
                <Radar size={15} />
              </div>
            </Link>
            {nav.map((item) => {
              const active = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex items-center gap-1.5 rounded-pill px-3 py-1.5 text-xs font-medium transition-colors",
                    active ? "bg-accent/10 text-accent" : "text-ink-dim"
                  )}
                >
                  <item.icon size={14} />
                  <span className="hidden sm:inline">{item.label}</span>
                </Link>
              );
            })}
          </nav>

          <div className="hidden items-center gap-2 md:flex">
            <RealtimeBadge status={connection} />
          </div>

          <div className="flex items-center gap-2">
            <span className="hidden text-sm font-medium text-ink-dim sm:block">
              {profile?.full_name}
            </span>
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

        <main className="min-w-0 flex-1 p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
