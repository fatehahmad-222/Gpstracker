import { redirect } from "next/navigation";
import { getSession } from "@/lib/supabaseServer";
import DeactivatedNotice from "./DeactivatedNotice";

export const metadata = {
  title: "Account inactive — Fleet Console",
};

/**
 * Terminal route for signed-in users who can't use the app (deactivated, or no
 * profile row). Not listed in middleware's matcher on purpose: it must stay
 * reachable while a session is still active so the client can sign out.
 */
export default async function InactivePage({ searchParams }) {
  const user = await getSession();
  if (!user) redirect("/login");

  const reason = searchParams?.reason === "missing" ? "missing" : "deactivated";

  return <DeactivatedNotice reason={reason} />;
}
