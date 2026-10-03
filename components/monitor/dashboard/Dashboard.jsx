"use client";

import { useCallback, useEffect, useState } from "react";
import {
  RefreshCw,
  Users,
  UserCheck,
  TrendingUp,
  UserX,
  Clock,
  ShieldAlert,
  Smartphone,
  CalendarClock,
  CheckCircle2,
  AlertTriangle,
  Info,
} from "lucide-react";

import { api } from "@/lib/monitor/client";
import {
  Card,
  KpiCard,
  AlertTile,
  StatusPill,
  NameAvatar,
  ProgressBar,
} from "@/components/monitor/primitives";
import { ErrorState, EmptyState, StatSkeleton, CardSkeleton } from "@/components/monitor/states";
import { cn } from "@/lib/utils";

/** Icon per KPI, kept beside the key so the strip reads as a set. */
const KPI_ICONS = {
  headcount: Users,
  present: UserCheck,
  attendance_rate: TrendingUp,
  absent: UserX,
  late: Clock,
  violations: ShieldAlert,
  devices: Smartphone,
  leaves: CalendarClock,
};

/**
 * Dashboard (spec 4.1).
 *
 * Three bands, in the order a manager reads them: what the company looks like
 * today, what the devices are doing, and what needs a decision.
 *
 * Every figure is pinned to the whole company. There are no row filters on this
 * page by design — a count that changed because you clicked something else on
 * the same page could not be read as "the state of the company today".
 */
export function Dashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.get("/api/monitor/dashboard"));
    } catch (err) {
      setError(err.message || "Could not load the dashboard");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (error) {
    return <ErrorState title="Could not load the dashboard" hint={error} onRetry={load} />;
  }

  if (loading && !data) {
    return (
      <div className="space-y-5">
        <StatSkeleton count={8} />
        <CardSkeleton count={4} />
      </div>
    );
  }

  if (!data) return null;

  const { summary, rate, kpis, tiles, command_center: groups, violations, departments, risk, open_sessions: openSessions } =
    data;

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="h-7 w-1.5 rounded-full bg-brand" aria-hidden="true" />
          <div>
            <h1 className="text-xl font-semibold text-ink">GPS Attendance Software</h1>
            <p className="text-[12px] text-ink-dim">
              {data.date} · {summary.total} employees · {rate.present} of {rate.denominator} on shift
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1.5 text-[12px] font-medium text-ink-dim hover:border-brand/40 hover:text-brand disabled:opacity-50"
        >
          <RefreshCw size={13} className={loading ? "animate-spin" : undefined} />
          Refresh
        </button>
      </header>

      {/* Band 1 - what the company looks like today. */}
      <section className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        {kpis.map((kpi) => (
          <KpiCard
            key={kpi.key}
            label={kpi.label}
            value={kpi.value}
            icon={KPI_ICONS[kpi.key]}
            accent={kpi.accent}
            hint={kpi.hint}
            loading={loading && !data}
          />
        ))}
      </section>

      <div className="grid gap-3 lg:grid-cols-3">
        <Card
          title="Daily summary"
          subtitle={`${rate.pct}% of everyone on shift`}
          action={<StatusPill status={rate.pct >= 90 ? "active" : rate.pct >= 75 ? "late" : "inactive"} label={rate.pct >= 90 ? "Healthy" : rate.pct >= 75 ? "Watch" : "Low"} />}
        >
          <ul className="space-y-2.5">
            <SummaryRow
              label="Present"
              value={summary.present}
              total={rate.denominator}
              bar={rate.pct}
              tone="bg-brand"
            />
            <SummaryRow
              label="Absent"
              value={summary.absent}
              total={rate.denominator}
              bar={rate.denominator ? (summary.absent / rate.denominator) * 100 : 0}
              tone="bg-crit"
            />
            <SummaryRow
              label="Late"
              value={summary.late}
              total={rate.denominator}
              bar={rate.denominator ? (summary.late / rate.denominator) * 100 : 0}
              tone="bg-high"
            />
            {summary.shift_not_started ? (
              <li className="flex items-center justify-between gap-2 text-[12px] text-ink-dim">
                <span>Shift not started</span>
                <span className="font-mono tabular-nums">{summary.shift_not_started}</span>
              </li>
            ) : null}
          </ul>
          <p className="mt-3 text-[11px] leading-relaxed text-ink-dim">
            {summary.shift_not_started
              ? `${summary.shift_not_started} employee(s) are excluded until their shift starts, so the rate is not dragged down by people who have not arrived yet.`
              : "Everyone's shift has started, so the rate covers the whole company."}
          </p>
        </Card>

        <Card title="By department" subtitle="Lowest attendance first">
          {departments.length ? (
            <ul className="space-y-2.5">
              {departments.map((dept) => (
                <li key={dept.name}>
                  <div className="flex items-center justify-between gap-2 text-[12px]">
                    <span className="truncate text-ink">{dept.name}</span>
                    <span className="shrink-0 font-mono tabular-nums text-ink-dim">
                      {dept.present}/{dept.total}
                    </span>
                  </div>
                  <ProgressBar
                    className="mt-1"
                    value={dept.pct}
                    tone={dept.pct >= 90 ? "bg-brand" : dept.pct >= 70 ? "bg-high" : "bg-crit"}
                  />
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState compact title="No departments" hint="Assign employees to a department to see this." />
          )}
        </Card>

        <Card title="Still clocked in" subtitle={`${openSessions.length} open session(s)`}>
          {openSessions.length ? (
            <ul className="space-y-1.5">
              {openSessions.slice(0, 8).map((session) => (
                <li key={session.id} className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <NameAvatar name={session.name} size={24} />
                    <div className="min-w-0">
                      <div className="truncate text-[12px] text-ink">{session.name}</div>
                      <div className="truncate text-[11px] text-ink-dim">{session.emp_code}</div>
                    </div>
                  </div>
                  <StatusPill status="active" label="In" />
                </li>
              ))}
              {openSessions.length > 8 ? (
                <li className="pt-1 text-[11px] text-ink-dim">
                  +{openSessions.length - 8} more
                </li>
              ) : null}
            </ul>
          ) : (
            <EmptyState compact icon={CheckCircle2} title="Everyone is out" hint="No open sessions right now." />
          )}
        </Card>
      </div>

      {/* Band 2 - what the devices are doing. */}
      <section className="space-y-2">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-[12px] font-semibold uppercase tracking-wide text-ink-dim">
            Device &amp; data alerts
          </h2>
          <p className="text-[11px] text-ink-dim">Last 7 days · {violations.total} violations raised</p>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-8">
          {tiles.map((tile) => (
            <AlertTile
              key={tile.key}
              severity={tile.severity}
              category={tile.category}
              title={tile.label}
              hint={tile.hint}
              count={tile.count}
              href="/monitor/alerts"
            />
          ))}
        </div>
      </section>

      {/* Band 3 - what needs a decision. */}
      <div className="grid gap-3 lg:grid-cols-3">
        <Card
          title="Needs attention"
          subtitle={`${violations.unresolved} unresolved`}
          className="lg:col-span-2"
          action={
            <a
              href="/monitor/alerts"
              className="text-[12px] font-medium text-brand hover:underline"
            >
              Open queue
            </a>
          }
        >
          {groups.some((g) => g.count) ? (
            <div className="space-y-3">
              {groups.map((group) =>
                group.count ? (
                  <div key={group.key}>
                    <div className="mb-1.5 flex items-center gap-2">
                      <GroupIcon severity={group.severity} />
                      <span className="text-[12px] font-semibold text-ink">{group.label}</span>
                      <span className="font-mono text-[11px] tabular-nums text-ink-dim">{group.count}</span>
                    </div>
                    <ul className="space-y-1">
                      {group.rows.map((row) => (
                        <li
                          key={row.id}
                          className="flex items-center justify-between gap-2 rounded-md border border-line px-2.5 py-1.5"
                        >
                          <div className="flex min-w-0 items-center gap-2">
                            <StatusPill
                              status={row.status === "resolved" ? "inactive" : "late"}
                              label={row.status}
                            />
                            <span className="truncate text-[12px] text-ink">{row.label}</span>
                          </div>
                          <span className="shrink-0 font-mono text-[11px] tabular-nums text-ink-dim">
                            {new Date(row.occurred_at).toLocaleDateString()}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null
              )}
            </div>
          ) : (
            <EmptyState
              compact
              icon={CheckCircle2}
              title="Nothing needs attention"
              hint="No unresolved violations in the last 7 days."
            />
          )}
        </Card>

        <Card title="Highest risk" subtitle="Weighted signal score">
          {risk.length ? (
            <ul className="space-y-1.5">
              {risk.map((row) => (
                <li key={row.employee_id} className="rounded-md border border-line px-2.5 py-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <NameAvatar name={row.name} size={24} />
                      <div className="min-w-0">
                        <div className="truncate text-[12px] text-ink">{row.name}</div>
                        <div className="truncate text-[11px] text-ink-dim">
                          {row.department_name || row.emp_code}
                        </div>
                      </div>
                    </div>
                    <span
                      className={cn(
                        "shrink-0 rounded-pill px-1.5 py-0.5 font-mono text-[11px] font-semibold tabular-nums",
                        row.band.className
                      )}
                    >
                      {row.score}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {row.reasons.map((reason) => (
                      <span
                        key={reason.key}
                        className="rounded-pill bg-surface-2 px-1.5 py-0.5 text-[10px] text-ink-dim"
                      >
                        {reason.label} ×{reason.count}
                      </span>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              compact
              icon={CheckCircle2}
              title="Nobody flagged"
              hint="No weighted signals in the last 7 days."
            />
          )}
        </Card>
      </div>
    </div>
  );
}

/** `tone` is a full Tailwind class, not a token name, so the JIT scanner sees it. */
function SummaryRow({ label, value, total, bar, tone }) {
  return (
    <li>
      <div className="flex items-center justify-between gap-2 text-[12px]">
        <span className="text-ink">{label}</span>
        <span className="font-mono tabular-nums text-ink-dim">
          {value} / {total}
        </span>
      </div>
      <ProgressBar className="mt-1" value={bar} tone={tone} />
    </li>
  );
}

function GroupIcon({ severity }) {
  if (severity === "critical") return <AlertTriangle size={13} className="text-crit" />;
  if (severity === "high") return <ShieldAlert size={13} className="text-high" />;
  return <Info size={13} className="text-med" />;
}