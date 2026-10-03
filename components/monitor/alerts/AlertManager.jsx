"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  RefreshCw,
  Search,
  ShieldAlert,
  Check,
  Eye,
  ChevronDown,
  ChevronRight,
  Radio,
} from "lucide-react";

import { api, qs, ApiError } from "@/lib/monitor/client";
import {
  Card,
  StatusPill,
  SeverityPill,
  DataTable,
  columnDef,
  NameAvatar,
} from "@/components/monitor/primitives";
import { ErrorState, EmptyState } from "@/components/monitor/states";
import { VIOLATION_CATEGORIES, canTransition, violationLabel } from "@/lib/monitor/alerts";
import { riskBand } from "@/lib/monitor/risk";
import { formatAge, formatHms } from "@/lib/monitor/datetime";
import { inputClass } from "@/components/monitor/config/fields";
import { cn } from "@/lib/utils";

const WINDOWS = [
  { value: "1", label: "24 hours" },
  { value: "7", label: "7 days" },
  { value: "30", label: "30 days" },
];

const SEVERITIES = ["", "critical", "high", "medium"];

/**
 * Alerts & Violation (spec 4.5).
 *
 * Two different numbers sit side by side and are deliberately labelled apart:
 * the tiles count *device events* in the window, the table lists *violations*
 * raised from them. One phone reporting the same fault hourly is many events
 * and one violation, so if the two were presented as the same figure every
 * reviewer would read the table as under-reporting.
 */
export function AlertManager() {
  const [windowDays, setWindowDays] = useState("7");
  const [status, setStatus] = useState("unresolved");
  const [category, setCategory] = useState("");
  const [severity, setSeverity] = useState("");
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState(search);

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [expanded, setExpanded] = useState(null);
  const [evidence, setEvidence] = useState({});
  const [evidenceLoading, setEvidenceLoading] = useState({});

  useEffect(() => {
    const handle = setTimeout(() => setDebounced(search), 300);
    return () => clearTimeout(handle);
  }, [search]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const payload = await api.get(
        `/api/monitor/alerts${qs({
          window_days: windowDays,
          status,
          category,
          severity,
          q: debounced,
        })}`
      );
      setData(payload);
    } catch (err) {
      setError(err.message || "Could not load alerts");
    } finally {
      setLoading(false);
    }
  }, [windowDays, status, category, severity, debounced]);

  useEffect(() => {
    load();
  }, [load]);

  async function setStatusOf(row, next) {
    setBusyId(row.id);
    setNotice(null);
    try {
      await api.patch(`/api/monitor/alerts/${row.id}`, { status: next });
      setNotice({ tone: "ok", text: `${row.name} — marked ${next.replace("_", " ")}.` });
      await load();
    } catch (err) {
      setNotice({
        tone: "crit",
        text: err instanceof ApiError ? err.message : "Could not update that violation",
      });
    } finally {
      setBusyId(null);
    }
  }

  /** The evidence log for one person, fetched on demand rather than up front. */
  async function toggleEvidence(row) {
    if (expanded === row.id) {
      setExpanded(null);
      return;
    }
    setExpanded(row.id);
    if (evidence[row.employee_id]) return;

    setEvidenceLoading((prev) => ({ ...prev, [row.employee_id]: true }));
    try {
      const payload = await api.get(
        `/api/monitor/alerts${qs({
          window_days: windowDays,
          events: 1,
          employee_id: row.employee_id,
          event_limit: 60,
        })}`
      );
      setEvidence((prev) => ({ ...prev, [row.employee_id]: payload.events || [] }));
    } catch {
      setEvidence((prev) => ({ ...prev, [row.employee_id]: [] }));
    } finally {
      setEvidenceLoading((prev) => ({ ...prev, [row.employee_id]: false }));
    }
  }

  const columns = useMemo(
    () => [
      columnDef({
        id: "severity",
        accessorKey: "severity",
        header: "Severity",
        size: 110,
        cell: ({ row }) => <SeverityPill severity={row.original.severity} />,
      }),
      columnDef({
        id: "type",
        accessorKey: "type",
        header: "Signal",
        size: 210,
        cell: ({ row }) => (
          <div className="min-w-0">
<div className="truncate font-medium text-ink">{row.original.label}</div>
            <div className="truncate text-[11px] text-ink-dim">{row.original.category}</div>
          </div>
        ),
      }),
      columnDef({
        id: "name",
        accessorKey: "name",
        header: "Employee",
        size: 210,
        cell: ({ row }) => (
          <div className="flex min-w-0 items-center gap-2">
            <NameAvatar name={row.original.name} size={26} />
            <div className="min-w-0">
              <div className="truncate font-medium text-ink">{row.original.name}</div>
              <div className="truncate text-[11px] text-ink-dim">
                {row.original.emp_code}
                {row.original.department_name ? ` · ${row.original.department_name}` : ""}
              </div>
            </div>
          </div>
        ),
      }),
      columnDef({
        id: "occurred_at",
        accessorKey: "occurred_at",
        header: "When",
        size: 150,
        cell: ({ row }) => (
          <div className="min-w-0">
            <div className="font-mono text-[12px] tabular-nums text-ink">
              {formatHms(row.original.occurred_at)}
            </div>
            <div className="text-[11px] text-ink-dim">{formatAge(row.original.occurred_at)} ago</div>
          </div>
        ),
      }),
      columnDef({
        id: "status",
        accessorKey: "status",
        header: "Status",
        size: 130,
        cell: ({ row }) => (
          <StatusPill
            status={row.original.status === "resolved" ? "inactive" : row.original.status === "acknowledged" ? "late" : "red"}
            label={row.original.status.replace("_", " ")}
          />
        ),
      }),
      columnDef({
        id: "actions",
        header: "",
        size: 200,
        cell: ({ row }) => {
          const { status: current } = row.original;
          const busy = busyId === row.id;
          return (
            <div className="flex items-center gap-1.5">
              {current === "open" ? (
                <ActionButton
                  icon={Eye}
                  label="Acknowledge"
                  disabled={busy}
                  onClick={() => setStatusOf(row.original, "acknowledged")}
                />
              ) : null}
              {canTransition(current, "resolved") ? (
                <ActionButton
                  icon={Check}
                  label="Resolve"
                  disabled={busy}
                  onClick={() => setStatusOf(row.original, "resolved")}
                />
              ) : null}
              <ActionButton
                icon={expanded === row.id ? ChevronDown : ChevronRight}
                label="Evidence"
                onClick={() => toggleEvidence(row.original)}
              />
            </div>
          );
        },
      }),
    ],
    // `setStatusOf` and `toggleEvidence` close over the current filters, so the
    // memo is deliberately invalidated by them rather than left stale.
    [busyId, expanded, windowDays] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const rows = data?.rows || [];
  const tiles = data?.tiles || [];
  const summary = data?.summary;
  const flagged = data?.flagged || [];

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[18px] font-semibold text-ink">Alerts &amp; Violation</h1>
          <p className="text-[12px] text-ink-dim">
            {data ? `${data.event_total} device events in the last ${data.window_days} days` : "Loading…"}
            {data ? ` → ${data.violation_total} violations raised` : ""}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={windowDays}
            onChange={(event) => setWindowDays(event.target.value)}
            className={cn(inputClass, "w-[130px]")}
            aria-label="Time window"
          >
            {WINDOWS.map((w) => (
              <option key={w.value} value={w.value}>
                {w.label}
              </option>
            ))}
          </select>

          <select
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            className={cn(inputClass, "w-[150px]")}
            aria-label="Status"
          >
            <option value="unresolved">Needs attention</option>
            <option value="open">Open</option>
            <option value="acknowledged">Acknowledged</option>
            <option value="resolved">Resolved</option>
            <option value="all">All</option>
          </select>

          <select
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            className={cn(inputClass, "w-[170px]")}
            aria-label="Category"
          >
            <option value="">All categories</option>
            {VIOLATION_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>

          <select
            value={severity}
            onChange={(event) => setSeverity(event.target.value)}
            className={cn(inputClass, "w-[130px]")}
            aria-label="Severity"
          >
            {SEVERITIES.map((s) => (
              <option key={s} value={s}>
                {s === "" ? "Any severity" : s[0].toUpperCase() + s.slice(1)}
              </option>
            ))}
          </select>

          <div className="relative">
            <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-dim" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search employee or signal"
              className={cn(inputClass, "w-[210px] pl-8")}
              aria-label="Search alerts"
            />
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
        </div>
      </header>

      {notice ? (
        <div
          className={cn(
            "rounded-lg border px-3 py-2 text-[12px]",
            notice.tone === "ok"
              ? "border-ok/30 bg-ok-tint text-ok"
              : "border-crit/30 bg-crit-tint text-crit"
          )}
        >
          {notice.text}
        </div>
      ) : null}

      <section className="space-y-2">
        <h2 className="text-[12px] font-semibold uppercase tracking-wide text-ink-dim">
          Device &amp; data signals
        </h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-8">
          {tiles.map((tile) => (
            <Card key={tile.key} className="px-2.5 py-2" title={undefined}>
              <div title={tile.hint}>
                <div className="truncate text-[11px] text-ink-dim" title={tile.label}>
                  {tile.label}
                </div>
                <div className="mt-0.5 flex items-baseline gap-1.5">
                  <span
                    className={cn(
                      "font-mono text-[20px] font-semibold tabular-nums",
                      tile.count > 0 ? "text-ink" : "text-ink-dim"
                    )}
                  >
                    {tile.count}
                  </span>
                  <span className="truncate text-[10px] text-ink-dim">{tile.category}</span>
                </div>
              </div>
            </Card>
          ))}
        </div>
      </section>

      <div className="grid gap-3 lg:grid-cols-3">
        <Card title="Queue" subtitle={summary ? `${summary.unresolved} need attention` : null} className="lg:col-span-2">
          {error ? (
            <ErrorState title="Could not load alerts" hint={error} onRetry={load} />
          ) : (
            <DataTable
              data={rows}
              columns={columns}
              loading={loading}
              rowHeight={52}
              getRowId={(row) => row.id}
              initialSort={[{ id: "occurred_at", desc: true }]}
              expandedRow={expanded ? evidenceRow(expanded, rows, evidence, evidenceLoading) : null}
              empty={{
                title: summary?.unresolved ? "Nothing matches these filters" : "Queue is clear",
                hint: summary?.unresolved
                  ? "Widen the window or clear a filter."
                  : "No violations in this period.",
              }}
            />
          )}
        </Card>

        <Card title="Highest risk" subtitle="Weighted signal score">
          {flagged.length ? (
            <ul className="space-y-1.5">
              {flagged.map((row) => {
                const band = riskBand(row.score);
                return (
                  <li
                    key={row.employee_id}
                    className="flex items-center justify-between gap-2 rounded-md border border-line px-2.5 py-1.5"
                  >
<span className="truncate text-[12px] text-ink">{row.name}</span>
                    <span className="flex shrink-0 items-center gap-1.5">
                      <span className="font-mono text-[12px] tabular-nums text-ink">{row.score}</span>
                      <span className={cn("rounded-pill px-1.5 py-0.5 text-[10px] font-semibold", band.className)}>
                        {band.label}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <EmptyState
              compact
              icon={ShieldAlert}
              title="Nobody flagged"
              hint="No weighted signals in this window."
            />
          )}
        </Card>
      </div>
    </div>
  );
}

function ActionButton({ icon: Icon, label, onClick, disabled }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      className={cn(
        "inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 text-[11px] font-medium text-ink-dim",
        "hover:border-brand/40 hover:text-brand disabled:opacity-50"
      )}
    >
      <Icon size={12} />
      {label}
    </button>
  );
}

/**
 * Expanded row: the raw event log for the person that violation belongs to.
 *
 * Returns the `{ id, content }` shape DataTable expects, or null when there is
 * nothing to show (the row has gone, or the fetch came back empty and there is
 * no row to hang it under).
 */
function evidenceRow(violationId, rows, evidence, evidenceLoading) {
  const row = rows.find((r) => r.id === violationId);
  if (!row) return null;

  const events = evidence[row.employee_id];
  const loading = evidenceLoading[row.employee_id];

  if (loading) {
    return {
      id: violationId,
      content: <div className="px-3 py-2 text-[12px] text-ink-dim">Loading device events…</div>,
    };
  }

  if (!events) return null;
  if (!events.length) {
    return {
      id: violationId,
      content: (
        <div className="px-3 py-2 text-[12px] text-ink-dim">No device events in this window.</div>
      ),
    };
  }

  return {
    id: violationId,
    content: (
      <div className="space-y-1 px-3 py-2">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-dim">
          Device events — {row.name}
        </div>
        {events.map((ev) => (
          <div key={ev.id} className="flex items-center gap-2 text-[12px]">
            <Radio size={11} className="shrink-0 text-ink-dim" />
            <span className="font-mono tabular-nums text-ink-dim">{formatHms(ev.occurred_at)}</span>
            <span className="truncate text-ink">{violationLabel(ev.type)}</span>
            {ev.delivery_delay_seconds != null && ev.delivery_delay_seconds > 60 ? (
              <span className="shrink-0 text-[11px] text-high">
                reached server {Math.round(ev.delivery_delay_seconds / 60)}m late
              </span>
            ) : null}
          </div>
        ))}
      </div>
    ),
  };
}