import { OrgUnitManager } from "@/components/monitor/config/OrgUnitManager";

export const metadata = { title: "Sub-Departments" };

export default function SubDepartmentsPage() {
  return (
    <OrgUnitManager
      kind="sub_departments"
      title="Sub-Departments"
      subtitle="Optional divisions inside a department. Designations can be attached at this level instead of the whole department."
      addLabel="Add sub-department"
    />
  );
}