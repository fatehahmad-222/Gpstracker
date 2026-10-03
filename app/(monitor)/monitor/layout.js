import { redirect } from "next/navigation";

import { getMonitorContext } from "@/lib/server/monitorClient";
import { guardMonitorPath } from "@/lib/monitor/rbac";
import { MonitorClientShell } from "./client-shell";

/**
 * Layout for the GPS Work Force Monitor module.
 *
 * Its own light shell (`mon` scope) rather than the existing Fleet Console
 * shell, per the agreed "separate light shell" decision. The `.mon` class
 * re-declares the semantic tokens on this subtree, so the app's dark default
 * cannot leak in and the existing `/dashboard` + `/app` routes are untouched.
 */

export const dynamic = "force-dynamic";

export default async function MonitorLayout({ children }) {
  const ctx = await getMonitorContext();

  if (!ctx.user) redirect("/login");
  if (!ctx.profile) redirect("/inactive");

  return (
    <MonitorClientShell
      role={ctx.role}
      companyCode={ctx.company?.company_code || ""}
      timezone={ctx.timezone || "Asia/Karachi"}
      settings={ctx.settings || {}}
      user={{
        id: ctx.user.id,
        name: ctx.profile.full_name || ctx.user.email || "",
        email: ctx.user.email || "",
      }}
    >
      {children}
    </MonitorClientShell>
  );
}

export async function guard(pathname) {
  const ctx = await getMonitorContext();
  const redirectTo = guardMonitorPath(pathname, ctx.role);
  if (redirectTo) redirect(redirectTo);
  return ctx;
}