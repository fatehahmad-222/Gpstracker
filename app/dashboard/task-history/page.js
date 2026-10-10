import { TaskHistory } from "@/components/monitor/tasks/TaskHistory";

export const dynamic = "force-dynamic";

/**
 * Task History — every task each employee has ever been assigned, active or
 * finished, with completion data where it exists. The all-employees counterpart
 * to the per-employee "Task history" section on the profile page.
 */
export const metadata = { title: "Task History" };

export default function TaskHistoryPage() {
  return <TaskHistory />;
}