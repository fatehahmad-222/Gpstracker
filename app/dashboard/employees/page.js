import { EmployeeManager } from "@/components/monitor/employees/EmployeeManager";

export const dynamic = "force-dynamic";

/**
 * Employees — the full directory, including the parts the Fleet Console card
 * grid never had: geofence assignment, department and designation, CSV import
 * and export. Each row links through to the profile page at
 * /dashboard/employees/[id], which keeps the location-history trail and the
 * task history from the original admin area.
 */
export const metadata = { title: "Employees" };

export default function EmployeesPage() {
  return <EmployeeManager />;
}