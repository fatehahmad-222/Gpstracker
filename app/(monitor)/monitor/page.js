import { StatSkeleton } from "@/components/monitor/states";

/**
 * Monitor module home — the Dashboard (spec 4.1).
 *
 * Phase 1 ships the shell, tokens, data layer and the summary query; the full
 * card set lands in Phase 7. Until then this renders the page frame with
 * skeletons so the route is navigable and the layout is reviewable.
 */
export const dynamic = "force-dynamic";

export default function DashboardPage() {
  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="h-7 w-1.5 rounded-full bg-brand" aria-hidden="true" />
          <h1 className="text-xl font-semibold text-ink">GPS Attendance Software</h1>
        </div>
      </header>

      <StatSkeleton count={6} />

      <section className="rounded-card border border-line bg-surface p-4 shadow-mon">
        <div className="text-label font-semibold uppercase text-ink-dim">Device &amp; Data Alerts</div>
        <StatSkeleton count={4} className="mt-3 sm:grid-cols-2 lg:grid-cols-4" />
      </section>
    </div>
  );
}