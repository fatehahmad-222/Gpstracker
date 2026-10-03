import { OrgUnitManager } from "@/components/monitor/config/OrgUnitManager";

export const metadata = { title: "Designations" };

export default function DesignationsPage() {
  return (
    <OrgUnitManager
      kind="designations"
      title="Designations"
      subtitle="Job titles available to employees. Attach one to a department or a sub-department to keep the employee list tidy."
      addLabel="Add designation"
    />
  );
}