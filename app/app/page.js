"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import { ClipboardList, Info } from "lucide-react";
import { useAuth } from "@/components/providers/AuthProvider";
import { useOwnTasks } from "@/hooks/useOwnTasks";
import { useTracking } from "@/components/employee/EmployeeTracker";
import { TaskCard, TaskEmptyHint } from "@/components/employee/TaskCard";
import { TrackingBanner } from "@/components/employee/TrackingStatus";
import { SkeletonCard } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { supabase } from "@/lib/supabaseClient";

export default function EmployeeHomePage() {
  const { user } = useAuth();
  const { tasks, error } = useOwnTasks(user?.id);
  const tracking = useTracking();

  const active = useMemo(
    () => (tasks ?? []).filter((t) => t.status === "pending" || t.status === "in_progress"),
    [tasks]
  );
  const done = useMemo(
    () => (tasks ?? []).filter((t) => t.status !== "pending" && t.status !== "in_progress"),
    [tasks]
  );

  async function handleStart(taskId) {
    await supabase.rpc("start_task", { p_task_id: taskId });
  }

  if (error) {
    return (
      <EmptyState
        icon={Info}
        title="Couldn’t load your tasks"
        description={error}
        action={
          <button onClick={() => window.location.reload()} className="text-sm font-medium text-accent hover:underline">
            Reload
          </button>
        }
      />
    );
  }

  return (
    <div className="space-y-5">
      <TrackingBanner />

      <section>
        <h2 className="mb-3 flex items-center gap-2 font-display text-sm font-semibold uppercase tracking-wider text-ink-dim">
          <ClipboardList size={16} />
          Active tasks {active.length > 0 && <span className="text-accent">({active.length})</span>}
        </h2>
        {!tasks ? (
          <div className="space-y-3">
            <SkeletonCard />
            <SkeletonCard />
          </div>
        ) : active.length === 0 ? (
          <div className="rounded-card border border-line bg-surface p-5 text-sm text-ink-dim">
            Nothing active right now — new assignments appear here live.
          </div>
        ) : (
          <AnimatePresence initial={false}>
            <div className="space-y-3">
              {active.map((task) => (
                <TaskCard key={task.id} task={task} position={tracking.position} onStart={handleStart} />
              ))}
            </div>
          </AnimatePresence>
        )}
      </section>

      <section>
        <h2 className="mb-3 font-display text-sm font-semibold uppercase tracking-wider text-ink-dim">
          Completed
        </h2>
        {!tasks ? null : done.length === 0 ? (
          <TaskEmptyHint />
        ) : (
          <div className="space-y-3 opacity-80">
            {done.map((task) => (
              <TaskCard key={task.id} task={task} position={null} onStart={handleStart} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
