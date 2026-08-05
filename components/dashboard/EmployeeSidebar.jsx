"use client";

import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Search, Users } from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import { Skeleton } from "@/components/ui/Skeleton";
import { cn, isOnline, timeAgo } from "@/lib/utils";
import { OFFLINE_AFTER_MS } from "@/lib/constants";

const filters = [
  { key: "all", label: "All" },
  { key: "online", label: "Online" },
  { key: "on_task", label: "On task" },
];

export default function EmployeeSidebar({
  profiles,
  positions,
  tasks,
  selectedId,
  onSelect,
  now,
  loading,
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");

  const rows = useMemo(() => {
    return profiles
      .map((profile) => {
        const pos = positions[profile.id] ?? null;
        const online = isOnline(pos?.recorded_at, now, OFFLINE_AFTER_MS);
        const activeTasks = tasks.filter((t) => t.employee_id === profile.id);
        return { profile, pos, online, activeTasks };
      })
      .filter((row) => {
        if (query.trim()) {
          const q = query.trim().toLowerCase();
          if (!row.profile.full_name?.toLowerCase().includes(q)) return false;
        }
        if (filter === "online" && !row.online) return false;
        if (filter === "on_task" && row.activeTasks.length === 0) return false;
        return true;
      })
      .sort((a, b) => {
        if (a.online !== b.online) return a.online ? -1 : 1;
        return (b.pos?.recorded_at ?? "").localeCompare(a.pos?.recorded_at ?? "");
      });
  }, [profiles, positions, tasks, query, filter, now]);

  const onlineCount = profiles.filter((p) => isOnline(positions[p.id]?.recorded_at, now, OFFLINE_AFTER_MS)).length;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-line px-4 py-3">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-ink-dim">
            <Users size={14} />
            Employees
          </div>
          <span className="font-mono text-xs text-accent">
            {onlineCount} online / {profiles.length}
          </span>
        </div>

        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-dim" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search employees…"
            className="w-full rounded-field border border-line bg-bg py-2 pl-9 pr-3 text-sm text-ink placeholder:text-ink-dim/60 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25"
          />
        </div>

        <div className="mt-2.5 flex gap-1.5">
          {filters.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={cn(
                "rounded-pill px-2.5 py-1 text-xs font-medium transition-colors",
                filter === f.key
                  ? "bg-accent/15 text-accent"
                  : "text-ink-dim hover:bg-surface-2 hover:text-ink"
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="space-y-3 p-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-14" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-ink-dim">
            {profiles.length === 0
              ? "No employees yet. Invite them to sign up."
              : "No employees match your search."}
          </div>
        ) : (
          <AnimatePresence initial={false}>
            {rows.map(({ profile, pos, online, activeTasks }) => {
              const selected = profile.id === selectedId;
              return (
                <motion.button
                  layout
                  key={profile.id}
                  onClick={() => onSelect(profile.id)}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  className={cn(
                    "flex w-full items-center gap-3 border-b border-line px-4 py-3 text-left transition-colors",
                    selected ? "bg-accent/8" : "hover:bg-surface-2"
                  )}
                >
                  <Avatar name={profile.full_name} size={36} online={online} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium text-ink">
                        {profile.full_name || "Unnamed"}
                      </span>
                      {pos && (
                        <span className="shrink-0 font-mono text-[11px] text-ink-dim">
                          {timeAgo(pos.recorded_at, now)}
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 flex items-center justify-between gap-2">
                      <span
                        className={cn(
                          "truncate text-xs",
                          activeTasks.length > 0 ? "text-warning" : "text-ink-dim"
                        )}
                      >
                        {activeTasks.length > 0
                          ? `Task: ${activeTasks[0].title}`
                          : online
                          ? "Online · no active task"
                          : "Offline"}
                      </span>
                      {!online && (
                        <span className="shrink-0 text-[10px] font-medium uppercase tracking-wide text-ink-dim">
                          Offline
                        </span>
                      )}
                    </div>
                  </div>
                </motion.button>
              );
            })}
          </AnimatePresence>
        )}
      </div>
    </div>
  );
}
