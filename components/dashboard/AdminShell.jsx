"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { ChevronDown, LogOut, Menu, Radar, X } from "lucide-react";
import { useAuth } from "@/components/providers/AuthProvider";
import { useTheme } from "@/components/providers/ThemeProvider";
import { useRealtimeStatus } from "@/hooks/useRealtimeStatus";
import RealtimeBadge from "./RealtimeBadge";
import { NAV, activeGroupKey, isNavItemActive } from "@/lib/dashboard/nav";
import { cn } from "@/lib/utils";

/**
 * The nav itself, shared by the desktop rail and the mobile drawer so both stay
 * in step.
 *
 * Exported so it can be mounted in a component test: it deliberately takes
 * `pathname` as a prop rather than calling usePathname itself, which means it
 * needs no router and no auth or theme providers to render.
 */
export function NavList({ pathname, onNavigate }) {
  const [expanded, setExpanded] = useState(() => {
    const key = activeGroupKey(pathname);
    return new Set(key ? [key] : []);
  });

  // Keep the group owning the current route open as the user moves around, so a
  // deep link never lands with its section collapsed and the current tab hidden.
  useEffect(() => {
    const key = activeGroupKey(pathname);
    if (key) setExpanded((prev) => (prev.has(key) ? prev : new Set(prev).add(key)));
  }, [pathname]);

  return (
    <ul className="space-y-0.5">
      {NAV.map((item) => {
        const active = isNavItemActive(item, pathname);
        const isGroup = Boolean(item.children);
        const open = isGroup && expanded.has(item.href);
        const Icon = item.icon;

        const rowClass = cn(
          "flex w-full items-center gap-3 rounded-field px-3 py-2 text-sm font-medium transition-colors",
          item.planned && !active && "text-ink-dim/60",
          active
            ? "bg-accent/10 text-accent"
            : "text-ink-dim hover:bg-surface-2 hover:text-ink"
        );

        return (
          <li key={item.href}>
            <div className="flex items-center">
              {isGroup ? (
                <button
                  type="button"
                  onClick={() =>
                    setExpanded((prev) => {
                      const next = new Set(prev);
                      if (next.has(item.href)) next.delete(item.href);
                      else next.add(item.href);
                      return next;
                    })
                  }
                  aria-expanded={open}
                  className={cn(rowClass, "flex-1 text-left")}
                >
                  <Icon size={18} strokeWidth={active ? 2.2 : 1.8} className="shrink-0" />
                  {item.label}
                </button>
              ) : (
                <Link
                  href={item.href}
                  onClick={onNavigate}
                  aria-current={active ? "page" : undefined}
                  className={cn(rowClass, "flex-1")}
                >
                  <Icon size={18} strokeWidth={active ? 2.2 : 1.8} className="shrink-0" />
                  {item.label}
                </Link>
              )}

              {isGroup ? (
                <button
                  type="button"
                  onClick={() =>
                    setExpanded((prev) => {
                      const next = new Set(prev);
                      if (next.has(item.href)) next.delete(item.href);
                      else next.add(item.href);
                      return next;
                    })
                  }
                  aria-label={open ? `Collapse ${item.label}` : `Expand ${item.label}`}
                  className="ml-0.5 rounded-field p-1.5 text-ink-dim transition-colors hover:text-ink"
                >
                  <ChevronDown size={15} className={cn("transition-transform", open && "rotate-180")} />
                </button>
              ) : null}
            </div>

            {isGroup && open ? (
              <ul className="mt-0.5 space-y-0.5 pl-3">
                {item.children.map((child) => {
                  const childActive = isNavItemActive(child, pathname);
                  return (
                    <li key={child.href}>
                      <Link
                        href={child.href}
                        onClick={onNavigate}
                        aria-current={childActive ? "page" : undefined}
                        className={cn(
                          "flex items-center gap-2.5 rounded-field px-3 py-1.5 text-[13px] transition-colors",
                          childActive
                            ? "bg-accent/10 font-medium text-accent"
                            : "text-ink-dim hover:bg-surface-2 hover:text-ink"
                        )}
                      >
                        <child.icon size={15} className="shrink-0" />
                        {child.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function Brand({ onClick }) {
  return (
    <Link href="/dashboard" onClick={onClick} className="flex items-center gap-2.5 px-5 py-5">
      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent text-bg">
        <Radar size={18} />
      </div>
      <div className="leading-tight">
        <div className="font-display text-sm font-semibold text-ink">Fleet Console</div>
        <div className="text-[11px] text-ink-dim">Admin</div>
      </div>
    </Link>
  );
}

export default function AdminShell({ children }) {
  const pathname = usePathname();
  const { profile, signOut } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const connection = useRealtimeStatus();
  const [drawerOpen, setDrawerOpen] = useState(false);

  // The drawer covers the page, so it must not survive a navigation or a resize
  // back to the desktop layout where it has no visible trigger.
  useEffect(() => setDrawerOpen(false), [pathname]);
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e) => e.key === "Escape" && setDrawerOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawerOpen]);

  return (
    <div className="flex min-h-dvh bg-bg">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-line bg-surface md:flex">
        <Brand />

        <nav className="flex-1 overflow-y-auto px-3 pb-3">
          <NavList pathname={pathname} />
        </nav>

        <div className="border-t border-line p-3">
          <RealtimeBadge status={connection} />
        </div>
      </aside>

      {/* Mobile drawer. The tab strip this replaced could not hold eighteen
          entries, and silently showing the first few made the rest unreachable. */}
      {drawerOpen ? (
        <div className="fixed inset-0 z-50 md:hidden">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setDrawerOpen(false)}
            aria-hidden="true"
          />
          <div className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col border-r border-line bg-surface">
            <div className="flex items-center justify-between">
              <Brand onClick={() => setDrawerOpen(false)} />
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                className="mr-3 rounded-field p-2 text-ink-dim transition-colors hover:text-ink"
                aria-label="Close navigation"
              >
                <X size={18} />
              </button>
            </div>
            <nav className="flex-1 overflow-y-auto px-3 pb-4">
              <NavList pathname={pathname} onNavigate={() => setDrawerOpen(false)} />
            </nav>
            <div className="border-t border-line p-3">
              <RealtimeBadge status={connection} />
            </div>
          </div>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-40 flex items-center justify-between gap-3 border-b border-line bg-bg/85 px-4 py-3 backdrop-blur md:px-6">
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-line text-ink-dim transition-colors hover:text-ink md:hidden"
            aria-label="Open navigation"
            aria-expanded={drawerOpen}
          >
            <Menu size={17} />
          </button>

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