"use client";

import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Ban, CheckCircle2, MapPin, Search } from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { GeoBadge, StatusBadge } from "@/components/ui/Badge";
import { SkeletonCard } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { cn, formatDateTime } from "@/lib/utils";

const columns = [
  { status: "pending", label: "Pending", tint: "text-warning" },
  { status: "in_progress", label: "In progress", tint: "text-info" },
  { status: "completed", label: "Completed", tint: "text-accent" },
];

const filterTabs = ["all", ...columns.map((c) => c.status)];

export default function TaskBoard({ tasks, profiles, onComplete, onCancel }) {
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState("all");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (tasks ?? []).filter((t) => {
      if (tab !== "all" && t.status !== tab) return false;
      if (!q) return true;
      const employee = profiles[t.employee_id]?.full_name ?? "";
      return (
        t.title.toLowerCase().includes(q) ||
        employee.toLowerCase().includes(q) ||
        (t.target_address ?? "").toLowerCase().includes(q)
      );
    });
  }, [tasks, profiles, query, tab]);

  if (!tasks) {
    return (
      <div className="grid gap-4 md:grid-cols-3">
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
      </div>
    );
  }

  if (tasks.length === 0) {
    return (
      <EmptyState
        icon={Search}
        title="No tasks yet"
        description="Assign your first task from the Overview page to get started."
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-0 flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-dim" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by title, employee, or address…"
            className="w-full rounded-field border border-line bg-bg py-2.5 pl-9 pr-3 text-sm text-ink placeholder:text-ink-dim/60 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25"
          />
        </div>
        <div className="flex gap-1.5">
          {filterTabs.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                "rounded-pill px-3 py-1.5 text-xs font-medium capitalize transition-colors",
                tab === t
                  ? "bg-accent/15 text-accent"
                  : "text-ink-dim hover:bg-surface-2 hover:text-ink"
              )}
            >
              {t === "all" ? "All" : t.replace("_", " ")}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {columns.map((col) => {
          const colTasks = filtered.filter((t) => t.status === col.status);
          return (
            <div key={col.status} className="flex flex-col rounded-card border border-line bg-surface/60 p-3">
              <div className="mb-3 flex items-center justify-between px-1">
                <span className={cn("text-xs font-semibold uppercase tracking-wider", col.tint)}>
                  {col.label}
                </span>
                <span className="rounded-pill bg-surface-2 px-2 py-0.5 font-mono text-xs text-ink-dim">
                  {colTasks.length}
                </span>
              </div>

              <div className="flex-1 space-y-3">
                <AnimatePresence initial={false}>
                  {colTasks.map((task) => (
                    <motion.div
                      layout
                      key={task.id}
                      initial={{ opacity: 0, scale: 0.97 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.95 }}
                      transition={{ type: "spring", damping: 28, stiffness: 320 }}
                      className="rounded-card border border-line bg-surface p-3.5 shadow-card"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="font-display text-sm font-semibold text-ink">
                          {task.title}
                        </h3>
                        <StatusBadge status={task.status} />
                      </div>

                      <div className="mt-2.5 flex items-center gap-2">
                        <Avatar name={profiles[task.employee_id]?.full_name} size={22} />
                        <span className="truncate text-xs font-medium text-ink-dim">
                          {profiles[task.employee_id]?.full_name || "Unknown employee"}
                        </span>
                      </div>

                      <div className="mt-2.5 space-y-1 text-xs text-ink-dim">
                        <div className="flex items-center gap-1.5">
                          <MapPin size={12} className="shrink-0" />
                          <span className="line-clamp-1">
                            {task.target_address || `${task.target_lat.toFixed(5)}, ${task.target_lng.toFixed(5)}`}
                          </span>
                        </div>
                        <div>Assigned {formatDateTime(task.created_at)}</div>
                        {task.due_at && <div>Due {formatDateTime(task.due_at)}</div>}
                        {task.status === "completed" && (
                          <div>
                            Completed {formatDateTime(task.completed_at)}{" "}
                            <GeoBadge source={task.completion_source} />
                          </div>
                        )}
                      </div>

                      {(task.status === "pending" || task.status === "in_progress") && (
                        <div className="mt-3 flex gap-2">
                          <Button
                            variant="primary"
                            size="xs"
                            className="flex-1"
                            onClick={() => onComplete(task)}
                          >
                            <CheckCircle2 size={13} /> Mark complete
                          </Button>
                          <Button variant="danger" size="xs" onClick={() => onCancel(task)}>
                            <Ban size={13} /> Cancel
                          </Button>
                        </div>
                      )}
                    </motion.div>
                  ))}
                </AnimatePresence>

                {colTasks.length === 0 && (
                  <div className="rounded-lg border border-dashed border-line px-3 py-6 text-center text-xs text-ink-dim">
                    Nothing here
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
