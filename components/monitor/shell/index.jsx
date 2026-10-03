"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Menu,
  ChevronDown,
  X,
  User2,
  LogOut,
  LayoutDashboard,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { NAV, ACCENTS, isNavItemActive, canAccessPath } from "@/lib/monitor/nav";
import { roleLabel } from "@/lib/monitor/rbac";

/** Sidebar item with its rounded-square coloured icon tile. */
function NavTile({ item, active, expanded, onToggle, pathname }) {
  const accent = ACCENTS[item.accent] || ACCENTS.brand;

  const tile = (
    <span
      className="grid h-7 w-7 shrink-0 place-items-center rounded-[9px] text-[13px] font-bold"
      style={{ backgroundColor: accent.bg, color: accent.fg }}
      aria-hidden="true"
    >
      <NavGlyph name={item.icon} />
    </span>
  );

  if (item.children) {
    return (
      <li>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          className={cn(
            "flex w-full items-center gap-3 rounded-r-xl py-2 pl-3 pr-3 text-left transition",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-strong",
            active ? "bg-white/10" : "hover:bg-white/5"
          )}
        >
          {tile}
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-[13px]",
              item.faded ? "text-white/40" : "text-white/90",
              active && "font-semibold text-white"
            )}
            title={item.label}
          >
            {item.label}
          </span>
          <ChevronDown
            size={14}
            className={cn("shrink-0 text-white/50 transition-transform", expanded && "rotate-180")}
            aria-hidden="true"
          />
        </button>

        {expanded ? (
          <ul className="mt-0.5 space-y-0.5">
            {item.children.map((child) => (
              <li key={child.key}>
                <Link
                  href={child.href}
                  className={cn(
                    "flex items-center gap-2 rounded-r-xl py-1.5 pr-3 text-[12.5px] transition",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-strong",
                    isNavItemActive({ href: child.href }, pathname)
                      ? "bg-white/10 font-semibold text-white"
                      : "text-white/65 hover:bg-white/5 hover:text-white"
                  )}
                  style={{ paddingLeft: 34 }}
                >
                  <span className="truncate" title={child.label}>
                    {child.label}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
      </li>
    );
  }

  return (
    <li>
      <Link
        href={item.href}
        title={item.label}
        className={cn(
          "relative flex items-center gap-3 rounded-r-xl py-2 pl-3 pr-3 transition",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-strong",
          active ? "bg-brand-deep" : "hover:bg-white/5",
          item.faded && "opacity-60"
        )}
      >
        {active ? (
          <span
            className="absolute inset-y-1 left-0 w-1 rounded-r bg-accent"
            aria-hidden="true"
          />
        ) : null}
        {tile}
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-[13px]",
            item.faded ? "text-white/45" : "text-white/90",
            active && "font-semibold text-white"
          )}
        >
          {item.label}
        </span>
      </Link>
    </li>
  );
}

/** Inline glyph lookup — a switch keeps nav.js free of React imports. */
function NavGlyph({ name }) {
  const path = GLYPHS[name];
  if (!path) return null;
  return (
    <svg
      viewBox="0 0 24 24"
      width="15"
      height="15"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.1"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {path.map((d, i) => (
        <path key={i} d={d} />
      ))}
    </svg>
  );
}

const GLYPHS = {
  LayoutDashboard: ["M3 3h7v9H3z", "M14 3h7v5h-7z", "M14 12h7v9h-7z", "M3 16h7v5H3z"],
  Settings2: ["M20 7h-9", "M14 17H5", "M17 4v6", "M7 14v6"],
  Radar: ["M12 2a10 10 0 1 0 10 10", "M12 7a5 5 0 1 0 5 5", "M12 12h.01"],
  Users: ["M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2", "M9 7a3 3 0 1 0 6 0 3 3 0 0 0-6 0", "M22 21v-2a4 4 0 0 0-3-3.87"],
  UserRoundPlus: ["M15 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2", "M8.5 7a3 3 0 1 0 6 0 3 3 0 0 0-6 0", "M19 8v6", "M22 11h-6"],
  MapPinned: ["M12 21s-7-6.2-7-11a7 7 0 1 1 14 0c0 4.8-7 11-7 11z", "M12 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4z"],
  MapPinCheck: ["M12 21s-7-6.2-7-11a7 7 0 1 1 14 0c0 4.8-7 11-7 11z", "M9 10l2 2 4-4"],
  Route: ["M6 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4z", "M18 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4z", "M8 17h5a3 3 0 0 0 0-6h-2a3 3 0 0 1 0-6h5"],
  CalendarDays: ["M8 2v4", "M16 2v4", "M3 10h18", "M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"],
  CalendarRange: ["M8 2v4", "M16 2v4", "M3 10h18", "M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z", "M8 15h3"],
  ShieldAlert: ["M12 2 4 5v7c0 5 3.4 9 8 10 4.6-1 8-5 8-10V5l-8-3z", "M12 8v5", "M12 16h.01"],
  HandCoins: ["M11 15h2a2 2 0 1 0 0-4h-3c-.6 0-1.1.2-1.4.6L3 17", "M14 12.5a2.5 2.5 0 1 0 0-5", "M3 21c1.2 0 2.4-.3 3.4-.9", "M18 21c-1 0-2-.3-2.9-.8"],
  ListChecks: ["M3 5h2l2 2h4", "M3 12h2l2 2h4", "M3 19h2l2 2h4", "M14 5h7", "M14 12h7", "M14 19h7"],
  Wallet: ["M3 7a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z", "M16 12h2"],
  FileBarChart: ["M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z", "M14 2v6h6", "M8 18v-3", "M12 18v-6", "M16 18v-4"],
  Timer: ["M10 2h4", "M12 14v-4", "M12 22a8 8 0 1 0 0-16 8 8 0 0 0 0 16z"],
  Handshake: ["M11 17 8 20l-4-4 4-4", "M13 17l3 3 4-4-4-4", "M8 12l3-3 2 2 3-3", "M13 8l3 3", "M3 8l3-3 3 3"],
};

export function MonitorSidebar({ open, onClose, role = "admin", pathname = "" }) {
  const [expanded, setExpanded] = useState(() => {
    const activeGroup = NAV.find((i) => i.children && isNavItemActive(i, pathname));
    return new Set(activeGroup ? [activeGroup.key] : []);
  });

  useEffect(() => {
    const activeGroup = NAV.find((i) => i.children && isNavItemActive(i, pathname));
    if (activeGroup) {
      setExpanded((prev) => new Set(prev).add(activeGroup.key));
    }
  }, [pathname]);

  const visible = NAV.filter((item) => canAccessPath(item.href || "/", role));

  return (
    <>
      {open ? (
        <div
          className="fixed inset-0 z-30 bg-black/40 lg:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      ) : null}

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex w-[264px] flex-col bg-brand-strong transition-transform lg:static lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full"
        )}
        aria-label="Main navigation"
      >
        <div className="flex h-14 items-center justify-between border-b border-white/10 px-4 lg:hidden">
          <span className="text-[13px] font-semibold text-white">Menu</span>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-white/80 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            aria-label="Close navigation"
          >
            <X size={17} />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto py-3 pr-2" aria-label="Modules">
          <ul className="space-y-0.5">
            {visible.map((item) => (
              <NavTile
                key={item.key}
                item={item}
                pathname={pathname}
                active={isNavItemActive(item, pathname)}
                expanded={expanded.has(item.key)}
                onToggle={() =>
                  setExpanded((prev) => {
                    const next = new Set(prev);
                    if (next.has(item.key)) next.delete(item.key);
                    else next.add(item.key);
                    return next;
                  })
                }
              />
            ))}
          </ul>
        </nav>

        <div className="border-t border-white/10 px-4 py-3">
          <Link
            href="/tracker"
            className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-[12px] text-white/70 transition hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden="true" />
            Open Live Tracker
          </Link>
        </div>
      </aside>
    </>
  );
}

export function MonitorTopBar({
  onToggleNav,
  user = {},
  role = "admin",
  companyCode = "",
  title = "GPS Attendance Software",
  onSignOut,
  notificationCount = 0,
}) {
  return (
    <header className="sticky top-0 z-20 flex h-14 items-center gap-3 bg-brand px-3 lg:px-4">
      <button
        type="button"
        onClick={onToggleNav}
        className="rounded-lg p-2 text-white transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white lg:hidden"
        aria-label="Toggle navigation"
      >
        <Menu size={19} />
      </button>

      <div className="flex min-w-0 flex-1 items-center gap-3">
        <span className="hidden h-2 w-2 rounded-full bg-white/40 sm:block" aria-hidden="true" />
        <h1 className="min-w-0 truncate text-[15px] font-semibold text-white">{title}</h1>
      </div>

      {companyCode ? (
        <span className="hidden rounded-pill bg-white/15 px-2.5 py-1 font-mono text-[11px] font-semibold tracking-wide text-white sm:inline-block">
          {companyCode}
        </span>
      ) : null}

      <details className="relative">
        <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg px-2 py-1.5 text-white transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white [&::-webkit-details-marker]:hidden">
          <span className="grid h-7 w-7 place-items-center rounded-full bg-white/15" aria-hidden="true">
            <User2 size={14} />
          </span>
          <span className="hidden text-[13px] font-medium sm:block">
            {user.name || user.email || "Account"}
          </span>
          <ChevronDown size={14} className="text-white/70" aria-hidden="true" />
        </summary>
        <div className="absolute right-0 top-full z-30 mt-1 w-56 rounded-card border border-line bg-surface p-1.5 shadow-pop">
          <div className="border-b border-line px-3 py-2">
            <div className="truncate text-[13px] font-semibold text-ink">
              {user.name || "Account"}
            </div>
            <div className="truncate text-[11px] text-ink-dim">{user.email || ""}</div>
            <div className="mt-1 inline-block rounded-pill bg-surface-2 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-ink-dim">
              {roleLabel(role)}
            </div>
          </div>
          <Link
            href="/dashboard"
            className="flex items-center gap-2 rounded-lg px-3 py-2 text-[12.5px] text-ink transition hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            <LayoutDashboard size={14} />
            Fleet Console
          </Link>
          {onSignOut ? (
            <button
              type="button"
              onClick={onSignOut}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[12.5px] text-crit transition hover:bg-crit-tint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-crit"
            >
              <LogOut size={14} />
              Sign out
            </button>
          ) : null}
        </div>
      </details>
    </header>
  );
}