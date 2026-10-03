import { Dashboard } from "@/components/monitor/dashboard/Dashboard";

export const dynamic = "force-dynamic";

/**
 * Monitor module home — the Dashboard (spec 4.1).
 *
 * The card set landed in Phase 7 on top of the signals, attendance and violation
 * layers built in the earlier phases.
 */
export const metadata = { title: "Dashboard" };

export default function DashboardPage() {
  return <Dashboard />;
}