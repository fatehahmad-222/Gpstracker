"use client";

import Link from "next/link";
import { ArrowUpRight, Users } from "lucide-react";
import { useLiveOverview } from "@/hooks/useLiveOverview";
import { Avatar } from "@/components/ui/Avatar";
import { SkeletonCard } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { cn, isOnline, timeAgo } from "@/lib/utils";
import { OFFLINE_AFTER_MS } from "@/lib/constants";

export default function EmployeesPage() {
  const { profiles, positions, tasks, loading, now } = useLiveOverview();

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-display text-xl font-semibold tracking-tight text-ink">
          Employees
        </h1>
        <p className="mt-0.5 text-sm text-ink-dim">
          Everyone on the field team. Click any employee for their location
          history and tasks.
        </p>
      </div>

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      ) : profiles.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No employees yet"
          description="Once field staff create accounts they’ll show up here automatically."
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {profiles.map((profile) => {
            const pos = positions[profile.id] ?? null;
            const online = isOnline(pos?.recorded_at, now, OFFLINE_AFTER_MS);
            const activeTasks = tasks.filter((t) => t.employee_id === profile.id);
            return (
              <Link
                key={profile.id}
                href={`/dashboard/employees/${profile.id}`}
                className="group rounded-card border border-line bg-surface p-4 transition-colors hover:border-accent/40"
              >
                <div className="flex items-center gap-3">
                  <Avatar name={profile.full_name} size={44} online={online} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate font-display text-sm font-semibold text-ink">
                        {profile.full_name || "Unnamed"}
                      </span>
                      <ArrowUpRight
                        size={14}
                        className="shrink-0 text-ink-dim opacity-0 transition-opacity group-hover:opacity-100"
                      />
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 text-xs text-ink-dim">
                      <span
                        className={cn(
                          "h-1.5 w-1.5 rounded-full",
                          online ? "bg-accent" : "bg-ink-dim"
                        )}
                      />
                      {online ? "Online" : "Offline"}
                      {pos && <span>· {timeAgo(pos.recorded_at, now)}</span>}
                    </div>
                  </div>
                </div>
                <div className="mt-3 flex items-center justify-between rounded-lg bg-surface-2 px-3 py-2 text-xs">
                  <span className="text-ink-dim">
                    {activeTasks.length > 0
                      ? `Active task: ${activeTasks[0].title}`
                      : "No active task"}
                  </span>
                  <span className="font-mono text-accent">{activeTasks.length}</span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
