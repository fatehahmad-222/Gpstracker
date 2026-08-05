"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { useAdminTasks } from "@/hooks/useAdminTasks";
import TaskBoard from "@/components/dashboard/TaskBoard";
import NewTaskModal from "@/components/dashboard/NewTaskModal";
import { Button } from "@/components/ui/Button";
import { supabase } from "@/lib/supabaseClient";

export default function TasksPage() {
  const { tasks, profiles, error } = useAdminTasks();
  const [modalOpen, setModalOpen] = useState(false);

  const employees = Object.values(profiles).filter((p) => p.role === "employee");

  async function completeTask(task) {
    await supabase
      .from("tasks")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
        completion_source: "manual",
      })
      .eq("id", task.id);
  }

  async function cancelTask(task) {
    await supabase
      .from("tasks")
      .update({ status: "cancelled" })
      .eq("id", task.id);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-semibold tracking-tight text-ink">
            Tasks
          </h1>
          <p className="mt-0.5 text-sm text-ink-dim">
            Every task across all employees. Tasks left in place auto-complete
            when the employee enters the target geofence.
          </p>
        </div>
        <Button onClick={() => setModalOpen(true)}>
          <Plus size={16} />
          New task
        </Button>
      </div>

      {error ? (
        <div className="rounded-card border border-danger/30 bg-danger/10 p-4 text-sm text-danger">
          {error}
        </div>
      ) : (
        <TaskBoard tasks={tasks} profiles={profiles} onComplete={completeTask} onCancel={cancelTask} />
      )}

      <NewTaskModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        employees={employees}
      />
    </div>
  );
}
