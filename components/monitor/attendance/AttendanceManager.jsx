"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw, Search, Users, UserCheck, UserX, Clock, LogOut, X } from "lucide-react";

import { api, qs, ApiError } from "@/lib/monitor/client";
import {
  Card,
  StatusPill,
  CountPill,
  DataTable,
  columnDef,
  num,
  NameAvatar,
} from "@/components/monitor/primitives";
import { ErrorState, InlineError } from "@/components/monitor/states";
import { STATUS_META } from "@/lib/monitor/attendance";
import { formatClockTime, formatDuration, shiftRangeLabel, toCompanyDate } from "@/lib/monitor/datetime";
import { inputClass } from "@/components/monitor/config/fields";
import { cn } from "@/lib/utils";

/**
 * Geo Tracking Attendance (spec 4.3).
 *
 * The daily view: one row per employee for the selected day, derived from the
 * punch log rather than the scheduled rollup so someone who clocked in two
 * minutes ago is already on screen.
 *
 * The header counts are always for the whole day and never react to a filter
 * chip, so "42 of 60 present" keeps meaning the same thing while the table is
 * narrowed — a header that recounts itself is a header nobody can read.
 */
export function AttendanceManager() {
  const today = useMemo(() => toCompanyDate(new Date()), []);

  const [date, setDate] = useState(today);
  const [departmentId, setDepartmentId] = useState("");
  const [status, setStatus] = useState("all");
  const [search, setSearch] = useState("");

  const [rows, setRows] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [summary, setSummary] = useState(null);
  const [chips, setChips] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [closing, setClosing] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get(
        `/api/monitor/attendance${qs({ date, department_id: departmentId, status, q: debounced })}`
      );
      setRows(data.rows || []);
      setSummary(data.summary || null);
      setChips(data.chips || []);
    } catch (err) {
      setError(err.message || "Could not load attendance");
    } finally {
      setLoading(false);
    }
  }, [date, departmentId, status, debounced]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    api
      .get(`/api/monitor/org-units${qs({ kind: "departments" })}`)
      .then((data) => setDepartments(data.rows || []))
      .catch(() => {
        // The department filter is optional; a failed lookup just omits it.
      });
  }, []);

  // The search box is debounced so typing a name is one request, not one per
  // keystroke. `search` stays local to the input; `debounced` drives the fetch.
  const [debounced, setDebounced] = useState(search);

  useEffect(() => {
    const handle = setTimeout(() => setDebounced(search), 300);
    return () => clearTimeout(handle);
  }, [search]);

  async function closeSession(row) {
    setClosing(row.open_session_id);
    setNotice(null);
    try {
      await api.patch(`/api/monitor/attendance/sessions/${row.open_session_id}`, {});
      setNotice({ tone: "ok", text: `Closed ${row.name}'s open session.` });
      await load();
    } catch (err) {
      setNotice({
        tone: "crit",
        text: err instanceof ApiError ? err.message : "Could not close that session",
      });
    } finally {
      setClosing(null);
    }
  }

  const columns = useMemo(
    () => [
      columnDef({
        id: "name",
        accessorKey: "name",
        header: "Employee",
        size: 230,
        cell: ({ row }) => (
          <div className="flex min-w-0 items-center gap-2">
            <NameAvatar name={row.original.name} size={28} />
            <div className="min-w-0">
              <div className="truncate font-medium text-ink">
                {row.original.name}
                {row.original.archived ? (
                  <span className="ml-1.5 text-[11px] font-normal text-ink-dim">(archived)</span>
                ) : null}
              </div>
              <div className="truncate text-[11px] text-ink-dim">
                {row.original.emp_code}
                {row.original.department_name ? ` · ${row.original.department_name}` : ""}
              </div>
            </div>
          </div>
        ),
      }),
      columnDef({
        id: "shift",
        accessorKey: "shift_start",
        header: "Shift",
        size: 120,
        cell: ({ row }) => (
          <span className="text-[12px] text-ink-dim">
            {shiftRangeLabel(row.original.shift_start, row.original.shift_end)}
          </span>
        ),
      }),
      columnDef({
        id: "status",
        accessorKey: "status",
        header: "Status",
        size: 140,
        cell: ({ row }) => {
          const meta = STATUS_META[row.original.status] || STATUS_META.absent;
          // Punctuality is the sharper signal, so it gets its own pill rather
          // than being buried in a tooltip.
          if (row.original.punctuality === "late") {
            return <StatusPill status="late" label={`Late ${row.original.late_minutes}m`} />;
          }
          return <StatusPill status={row.original.status} label={meta.label} />;
        },
      }),
      columnDef({
        id: "first_in",
        accessorKey: "first_in",
        header: "First In",
        size: 100,
        cell: ({ row }) => (
          <span className="font-mono text-[12px] tabular-nums text-ink">
            {row.original.first_in ? formatClockTime(row.original.first_in) : "-"}
          </span>
        ),
      }),
      columnDef({
        id: "last_out",
        accessorKey: "last_out",
        header: "Last Out",
        size: 100,
        cell: ({ row }) => (
          <span className="font-mono text-[12px] tabular-nums text-ink">
            {row.original.last_out ? formatClockTime(row.original.last_out) : "-"}
          </span>
        ),
      }),
      columnDef({
        id: "stay_seconds",
        accessorKey: "stay_seconds",
        header: "Worked",
        size: 110,
        cell: ({ row }) =>
          num(
            row.original.open_session_id
              ? "in progress"
              : row.original.stay_seconds
                ? formatDuration(row.original.stay_seconds)
                : "-"
          ),
      }),
      columnDef({
        id: "overtime_seconds",
        accessorKey: "overtime_seconds",
        header: "Overtime",
        size: 100,
        cell: ({ row }) =>
          num(row.original.overtime_seconds ? formatDuration(row.original.overtime_seconds) : "-"),
      }),
      columnDef({
        id: "actions",
        header: "",
        size: 110,
        cell: ({ row }) =>
          row.original.open_session_id ? (
            <button
              type="button"
              onClick={() => closeSession(row)}
              disabled={closing === row.original.open_session_id}
              className={cn(
                "inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 text-[11px] font-medium text-ink-dim",
                "hover:border-brand/40 hover:text-brand disabled:opacity-50"
              )}
            >
              <LogOut size={12} />
              {closing === row.original.open_session_id ? "Closing…" : "Close"}
            </button>
          ) : (
            <span className="text-[11px] text-ink-dim">-</span>
          ),
      }),
    ],
    // `closeSession` closes over `loading`, so it is listed rather than
    // suppressed — otherwise the button would keep a stale handler.
    [closing] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const tiles = useMemo(() => {
    if (!summary) return [];
    return [
      { key: "total", label: "Roster", value: summary.total, icon: Users, tone: "brand" },
      { key: "present", label: "Present", value: summary.present, icon: UserCheck, tone: "ok" },
      { key: "absent", label: "Absent", value: summary.absent, icon: UserX, tone: "crit" },
      {
        key: "not_started",
        label: "Not Started",
        value: summary.shift_not_started,
        icon: Clock,
        tone: "neutral",
      },
      { key: "late", label: "Late", value: summary.late, icon: Clock, tone: "warn" },
    ];
  }, [summary]);

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[18px] font-semibold text-ink">Geo Tracking Attendance</h1>
          <p className="text-[12px] text-ink-dim">
            {rows.length} shown · derived from the punch log, not the nightly rollup
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            type="date"
            value={date}
            max={today}
            onChange={(event) => setDate(event.target.value)}
            className={cn(inputClass, "w-[150px]")}
            aria-label="Attendance date"
          />

          <select
            value={departmentId}
            onChange={(event) => setDepartmentId(event.target.value)}
            className={cn(inputClass, "w-[170px]")}
            aria-label="Department"
          >
            <option value="">All departments</option>
            {departments.map((dept) => (
              <option key={dept.id} value={dept.id}>
                {dept.name}
              </option>
            ))}
          </select>

          <div className="relative">
            <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-dim" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search name or code"
              className={cn(inputClass, "w-[200px] pl-8")}
              aria-label="Search employees"
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
            "flex items-center gap-2 rounded-lg border px-3 py-2 text-[12px]",
            notice.tone === "ok"
              ? "border-ok/30 bg-ok-tint text-ok"
              : "border-crit/30 bg-crit-tint text-crit"
          )}
        >
          <span className="flex-1">{notice.text}</span>
          <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss">
            <X size={13} />
          </button>
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {tiles.map((tile) => {
          const Icon = tile.icon;
          return (
            <Card key={tile.key} className="px-3 py-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] uppercase tracking-wide text-ink-dim">{tile.label}</span>
                <Icon size={14} className="text-ink-dim" />
              </div>
              <div className="mt-1 font-mono text-[22px] font-semibold tabular-nums text-ink">
                {loading && summary === null ? "-" : tile.value}
              </div>
            </Card>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {chips.map((chip) => (
          <button
            key={chip.key}
            type="button"
            onClick={() => setStatus(chip.key)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] font-medium transition",
              status === chip.key
                ? "border-brand bg-brand text-white"
                : "border-line bg-surface text-ink-dim hover:border-brand/40 hover:text-ink"
            )}
          >
            {chip.label}
            <CountPill tone={status === chip.key ? "brand" : "neutral"}>{chip.count}</CountPill>
          </button>
        ))}
      </div>

      {error ? (
        <ErrorState title="Could not load attendance" hint={error} onRetry={load} />
      ) : (
        <Card bodyClassName="p-0">
          <DataTable
            data={rows}
            columns={columns}
            loading={loading}
            rowHeight={52}
            getRowId={(row) => row.employee_id}
            initialSort={[{ id: "status", desc: false }]}
            empty={{
              title: "Nobody to show",
              hint: date === today ? "No one has clocked in yet for today." : "No punches were recorded on this date.",
            }}
          />
        </Card>
      )}
    </div>
  );
}