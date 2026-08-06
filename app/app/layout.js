import { redirect } from "next/navigation";
import { getProfile, getSession } from "@/lib/supabaseServer";
import AppShell from "@/components/employee/AppShell";

export const metadata = {
  title: "My Tasks — Fleet Console",
};

export default async function AppLayout({ children }) {
  const user = await getSession();
  if (!user) redirect("/login");

  const profile = await getProfile();
  if (profile && profile.is_active === false) redirect("/login");
  if (profile?.role !== "employee") redirect("/dashboard");

  return <AppShell>{children}</AppShell>;
}
