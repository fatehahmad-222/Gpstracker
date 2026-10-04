import { OrgUnitManager } from "@/components/monitor/config/OrgUnitManager";

export const metadata = { title: "Departments" };

export default function DepartmentsPage() {
  return (
    <OrgUnitManager
      kind="departments"
      title="Departments"
      subtitle="The top level of the company structure. Employees, designations and policies all roll up to a department."
      addLabel="Add department"
    />
  );
}