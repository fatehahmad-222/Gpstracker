"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw, Search, Radio } from "lucide-react";

import { api, qs, ApiError } from "@/lib/monitor/client";
import { Card, StatusPill, CountPill, DataTable, columnDef, num, NameAvatar } from "@/components/monitor/primitives";
import { ErrorState } from "@/components/monitor/states";
import { formatClockTime, formatDuration, toCompanyDate } from "@/lib/monitor/datetime";
import { inputClass } from "@/components/monitor/config/fields";
import { cn } from "@/lib/utils";

/** How a session ended. Mirrors the CHECK constraint on `out_reason`. */
const OUT_REASONS = [
  { value: "", label: "Any reason" },
  { value: "user", label: "Punched out" },
  { value: "auto_location_off", label: "Left the area" },
  { value: "auto_shift_end", label: "Shift ended" },
  { value: "admin", label: "Closed by admin" },
  { value: "still_in", label: "Still inside" },
];

const REASON_LABEL = Object.fromEntries(
  OUT_REASONS.filter((r) => r.value).map((r) => [r.value, r.label])
);

/**
 * Attendance logs (spec 4.3).
 *
 * One row per clock-in — the raw log rather than the derived day, because this
 * is the screen a manager checks when somebody disputes their hours. An open
 * session is called out at the top, since "who is still on the clock right now"
 * is the question this page is usually opened to answer.
 */
export function AttendanceLogs() {
  const today = useMemo(() => toCompanyDate(new Date()), []);

  const [date, setDate] = useState(today);
  const [outReason, setOutReason] = useState("");
  const [openOnly, setOpenOnly] = useState(false);
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState(search);

  const [rows, setRows] = useState([]);
  const [openSessions, setOpenSessions] = useState([]);
  const [trend, setTrend] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const handle = setTimeout(() => setDebounced(search), 300);
    return () => clearTimeout(handle);
  }, [search]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get(
        `/api/monitor/attendance/logs${qs({
          date,
          out_reason: outReason,
          open: openOnly ? "1" : "",
          q: debounced,
          page_size: 200,
        })}`
      );
      setRows(data.rows || []);
      setOpenSessions(data.open_sessions || []);
      setTrend(data.trend || []);
    } catch (err) {
      setError(err.message || "Could not load the attendance log");
    } finally {
      setLoading(false);
    }
  }, [date, outReason, openOnly, debounced]);

  useEffect(() => {
    load();
  }, [load]);

  const columns = useMemo(
    () => [
      columnDef({
        id: "name",
        accessorKey: "name",
        header: "Employee",
        size: 220,
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
        id: "clock_in_at",
        accessorKey: "clock_in_at",
        header: "Clock In",
        size: 130,
        cell: ({ row }) => (
          <span className="font-mono text-[12px] tabular-nums text-ink">
            {formatClockTime(row.original.clock_in_at)}
          </span>
        ),
      }),
      columnDef({
        id: "clock_out_at",
        accessorKey: "clock_out_at",
        header: "Clock Out",
        size: 130,
        cell: ({ row }) =>
          row.original.clock_out_at ? (
            <span className="font-mono text-[12px] tabular-nums text-ink">
              {formatClockTime(row.original.clock_out_at)}
            </span>
          ) : (
            <StatusPill status="active" dot={false} label="Still in" />
          ),
      }),
      columnDef({
        id: "stay_seconds",
        accessorKey: "stay_seconds",
        header: "Duration",
        size: 110,
        cell: ({ row }) => num(row.original.open ? "-" : formatDuration(row.original.stay_seconds)),
      }),
      columnDef({
        id: "out_reason",
        accessorKey: "out_reason",
        header: "Reason",
        size: 150,
        cell: ({ row }) =>
          row.original.out_reason ? (
            <span className="text-[12px] text-ink-dim">
              {REASON_LABEL[row.original.out_reason] || row.original.out_reason}
            </span>
          ) : (
            <span className="text-[12px] text-ink-dim">-</span>
          ),
      }),
      columnDef({
        id: "clock_in_lat",
        header: "Punch Location",
        size: 190,
        cell: ({ row }) => {
          const { clock_in_lat: lat, clock_in_lng: lng } = row.original;
          if (lat == null || lng == null) {
            return <span className="text-[11px] text-ink-dim">No GPS fix</span>;
          }
          return (
            <span className="font-mono text-[11px] tabular-nums text-ink-dim">
              {lat.toFixed(5)}, {lng.toFixed(5)}
            </span>
          );
        },
      }),
      columnDef({
        id: "source",
        accessorKey: "source",
        header: "Source",
        size: 110,
        cell: ({ row }) => (
          <span className="text-[11px] text-ink-dim">{row.original.source || "GPS APP"}</span>
        ),
      }),
    ],
    []
  );

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[18px] font-semibold text-ink">Attendance Logs</h1>
          <p className="text-[12px] text-ink-dim">Every punch reported by the mobile app</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            type="date"
            value={date}
            max={today}
            onChange={(event) => setDate(event.target.value)}
            className={cn(inputClass, "w-[150px]")}
            aria-label="Log date"
          />

          <select
            value={outReason}
            onChange={(event) => setOutReason(event.target.value)}
            className={cn(inputClass, "w-[170px]")}
            aria-label="Clock-out reason"
          >
            {OUT_REASONS.map((reason) => (
              <option key={reason.value} value={reason.value}>
                {reason.label}
              </option>
            ))}
          </select>

          <label className="inline-flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1.5 text-[12px] font-medium text-ink-dim">
            <input
              type="checkbox"
              checked={openOnly}
              onChange={(event) => setOpenOnly(event.target.checked)}
              className="accent-brand"
            />
            Still clocked in
          </label>

          <div className="relative">
            <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-dim" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search name or code"
              className={cn(inputClass, "w-[190px] pl-8")}
              aria-label="Search punches"
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

      {openSessions.length ? (
        <Card title="Still on the clock" subtitle="Open right now, regardless of date" live>
          <ul className="flex flex-wrap gap-2">
            {openSessions.map((session) => (
              <li
                key={session.id}
                className="inline-flex items-center gap-2 rounded-pill border border-ok/30 bg-ok-tint px-2.5 py-1 text-[12px] text-ink"
              >
                <Radio size={12} className="text-ok" />
                <span className="font-medium">{session.name}</span>
                <span className="font-mono tabular-nums text-ink-dim">
                  since {formatClockTime(session.clock_in_at)}
                </span>
                <CountPill tone="neutral">{formatDuration(session.age_seconds)}</CountPill>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {trend.length ? (
        <Card title="Last 7 days" subtitle="From the nightly rollup">
          <div className="flex items-end gap-1.5">
            {trend.map((day) => {
              const height = Math.max(6, Math.round((day.pct / 100) * 64));
              return (
                <div key={day.date} className="flex flex-1 flex-col items-center gap-1">
                  <span className="font-mono text-[10px] tabular-nums text-ink-dim">{day.pct}%</span>
                  <div
                    className={cn(
                      "w-full rounded-t",
                      day.pct >= 90 ? "bg-ok" : day.pct >= 60 ? "bg-warn" : "bg-crit"
                    )}
                    style={{ height }}
                    title={`${day.date}: ${day.present} present of ${day.pct}%`}
                  />
                  <span className="text-[10px] text-ink-dim">{day.date.slice(5).replace("-", "/")}</span>
                </div>
              );
            })}
          </div>
        </Card>
      ) : null}

      {error ? (
        <ErrorState title="Could not load the attendance log" hint={error} onRetry={load} />
      ) : (
        <Card bodyClassName="p-0">
          <DataTable
            data={rows}
            columns={columns}
            loading={loading}
            rowHeight={48}
            getRowId={(row) => row.id}
            initialSort={[{ id: "clock_in_at", desc: true }]}
            empty={{
              title: "No punches recorded",
              hint: openOnly ? "Everybody has clocked out." : "Nothing was reported for this date.",
            }}
          />
        </Card>
      )}
    </div>
  );
}