import { Dashboard } from "@/components/monitor/dashboard/Dashboard";

export const dynamic = "force-dynamic";

/**
 * Command Center — everything happening right now, grouped by severity.
 *
 * This was a placeholder until the monitor's Dashboard arrived from /monitor.
 * It is the operational view: attendance, devices, violations and the
 * department rollup, where /dashboard itself stays the fleet overview with
 * its map and activity feed.
 */
export const metadata = { title: "Command Center" };

export default function CommandCenterPage() {
  return <Dashboard />;
}