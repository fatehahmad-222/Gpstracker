import { requireRole } from "@/lib/authGuard";
import AppShell from "@/components/employee/AppShell";

export const metadata = {
  title: "My Tasks — Fleet Console",
};

export default async function AppLayout({ children }) {
  await requireRole("employee");

  return <AppShell>{children}</AppShell>;
}
