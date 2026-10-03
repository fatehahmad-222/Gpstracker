import { requireRole } from "@/lib/authGuard";
import AdminShell from "@/components/dashboard/AdminShell";

export const metadata = {
  title: "Fleet Console — Admin",
};

export default async function DashboardLayout({ children }) {
  await requireRole("admin");

  return <AdminShell>{children}</AdminShell>;
}
