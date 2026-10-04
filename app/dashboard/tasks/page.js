import { TaskManager } from "@/components/monitor/tasks/TaskManager";

export const dynamic = "force-dynamic";

/**
 * Tasks — the field task list, with create, assignment and the full status
 * transition set. This replaces the kanban TaskBoard, which could only
 * complete and cancel; the board's per-column view is a different shape of
 * the same data and the table carries more of it (assignee, target address,
 * geofence-linked completion).
 */
export const metadata = { title: "Tasks" };

export default function TasksPage() {
  return <TaskManager />;
}