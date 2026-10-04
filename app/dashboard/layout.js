import { requireRole } from "@/lib/authGuard";
import AdminShell from "@/components/dashboard/AdminShell";

export const metadata = {
  title: "Fleet Console — Admin",
};

export default async function DashboardLayout({ children }) {
  // `viewer` is a read-only console role, so it belongs here rather than on the
  // employee app. Write actions are refused separately, per request, by
  // requireContext({ write: true }) -- the shell does not decide that.
  await requireRole("admin", "viewer");

  return <AdminShell>{children}</AdminShell>;
}
