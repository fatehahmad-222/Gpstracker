import { redirect } from "next/navigation";
import { getProfile, getSession } from "@/lib/supabaseServer";

export const metadata = {
  title: "Fleet Console",
};

export default async function HomePage() {
  const user = await getSession();
  if (!user) redirect("/login");

  const profile = await getProfile();
  if (profile?.role === "admin") redirect("/dashboard");
  redirect("/app");
}
