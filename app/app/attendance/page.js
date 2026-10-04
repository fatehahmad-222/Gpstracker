"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Clock, LogIn, LogOut } from "lucide-react";
import { api, ApiError } from "@/lib/monitor/client";
import { formatClockTime, formatDuration, addDays } from "@/lib/monitor/datetime";
import { cn } from "@/lib/utils";

export default function EmployeeAttendancePage() {
  const [day, setDay] = useState(null);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (target) => {
    setLoading(true);
    setError(null);
    try {
      const payload = await api.get(`/api/app/attendance?date=${target}`);
      setData(payload);
      setDay(payload.date);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not load your attendance");
    } finally {
      setLoading(false);
    }
  }, []);

  // First paint: ask the server for "today" in the company's timezone rather
  // than guessing from the phone clock, which is often wrong in the field.
  useEffect(() => {
    load("");
  }, [load]);

  const rows = data?.rows || [];
  const worked = rows.reduce((sum, r) => sum + (r.stay_seconds || 0), 0);

  return (
    <div className="space-y-4">
      <header>
        <h1 className="font-display text-xl font-semibold tracking-tight text-ink">My attendance</h1>
        <p className="mt-0.5 text-sm text-ink-dim">
          Your own shifts, taken from the same punches your manager sees.
        </p>
      </header>

      <div className="flex items-center justify-between rounded-2xl border border-line bg-surface p-3">
        <button
          onClick={() => day && load(addDays(day, -1))}
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-line text-ink-dim transition-colors hover:text-ink"
          aria-label="Previous day"
        >
          <ChevronLeft size={17} />
        </button>
        <div className="flex items-center gap-2 text-sm font-medium text-ink">
          <CalendarDays size={15} className="text-ink-dim" />
          {day || "\u2014"}
        </div>
        <button
          onClick={() => day && load(addDays(day, 1))}
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-line text-ink-dim transition-colors hover:text-ink"
          aria-label="Next day"
        >
          <ChevronRight size={17} />
        </button>
      </div>

      {error ? (
        <p className="rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      ) : null}

      <div
        className={cn(
          "rounded-2xl border p-4",
          data?.is_open ? "border-success/40 bg-success/10" : "border-line bg-surface"
        )}
      >
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-wide text-ink-dim">
              {data?.is_open ? "On shift" : "Not clocked in"}
            </p>
            <p className="mt-0.5 font-display text-lg font-semibold text-ink">
              {data?.open_session?.clock_in_at
                ? `Since ${formatClockTime(data.open_session.clock_in_at)}`
                : "\u2014"}
            </p>
          </div>
          <Clock size={20} className={data?.is_open ? "text-success" : "text-ink-dim"} />
        </div>
      </div>

      <div className="flex items-center justify-between px-1 text-xs text-ink-dim">
        <span>{rows.length} shift{rows.length === 1 ? "" : "s"}</span>
        {worked > 0 ? <span>{formatDuration(worked)} worked</span> : null}
      </div>

      {loading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-20 animate-pulse rounded-2xl border border-line bg-surface-2" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <p className="rounded-2xl border border-line bg-surface px-4 py-8 text-center text-sm text-ink-dim">
          No shifts recorded for this day.
        </p>
      ) : (
        <ul className="space-y-2">
          {rows.map((row) => (
            <li key={row.id} className="rounded-2xl border border-line bg-surface p-4">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-sm font-medium text-ink">
                  <LogIn size={14} className="text-success" />
                  {formatClockTime(row.clock_in_at)}
                </span>
                <span
                  className={cn(
                    "flex items-center gap-1.5 text-sm",
                    row.open ? "font-medium text-success" : "text-ink-dim"
                  )}
                >
                  {row.open ? (
                    "Open"
                  ) : (
                    <>
                      <LogOut size={14} />
                      {formatClockTime(row.clock_out_at)}
                    </>
                  )}
                </span>
              </div>
              <p className="mt-2 text-xs text-ink-dim">
                {row.open
                  ? "Still open"
                  : `${formatDuration(row.stay_seconds)}${row.out_reason ? ` · closed: ${row.out_reason.replace(/_/g, " ")}` : ""}`}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}