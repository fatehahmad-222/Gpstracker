import { redirect } from "next/navigation";
import { getProfile, getSession } from "@/lib/supabaseServer";
import AdminShell from "@/components/dashboard/AdminShell";

export const metadata = {
  title: "Fleet Console — Admin",
};

export default async function DashboardLayout({ children }) {
  const user = await getSession();
  if (!user) redirect("/login");

  const profile = await getProfile();
  if (profile?.role !== "admin") redirect("/app");

  return <AdminShell>{children}</AdminShell>;
}
