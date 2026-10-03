"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { AlertTriangle, Radio, RefreshCw } from "lucide-react";

import { api } from "@/lib/monitor/client";
import { usePolling } from "@/hooks/monitor/usePolling";
import { useQueryState } from "@/hooks/monitor/useQueryState";
import { Card, LivePill } from "@/components/monitor/primitives";
import { EmptyState, ErrorState } from "@/components/monitor/states";
import { cn } from "@/lib/utils";

const LiveMap = dynamic(() => import("@/components/monitor/map/LiveMap"), {
  ssr: false,
  loading: () => (
    <div className="flex h-[560px] items-center justify-center rounded-tile border border-line bg-surface-2 text-[12.5px] text-ink-dim">
      Loading map…
    </div>
  ),
});

/** 15s while someone is watching: enough to feel live, cheap enough to sustain. */
const REFRESH_MS = 15000;

const LEGEND = [
  { color: "#16a34a", label: "Inside an assigned fence" },
  { color: "#f59e0b", label: "Outside every assigned fence" },
  { color: "#94a3b8", label: "Stale fix (over 5 min old)" },
  { color: "#64748b", label: "No fence assigned" },
];

export function LiveMapScreen() {
  const { values: filters, setParam } = useQueryState({ department_id: "" });

  const [positions, setPositions] = useState([]);
  const [fences, setFences] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (filters.department_id) params.set("department_id", filters.department_id);
    const qs = params.toString();

    const [positionData, fenceData] = await Promise.all([
      api.get(`/api/monitor/positions${qs ? `?${qs}` : ""}`),
      api.get("/api/monitor/geofences?status=active"),
    ]);

    setPositions(positionData.rows || []);
    setFences(fenceData.rows || []);
    setError(null);
  }, [filters.department_id]);

  const { lastUpdated, refresh } = usePolling(load, { intervalMs: REFRESH_MS });

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setLoading(true);
      try {
        await load();
        const data = await api.get("/api/monitor/org-units?kind=department");
        if (!cancelled) setDepartments(data.rows || []);
      } catch (err) {
        if (!cancelled) setError(err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [load]);

  const counts = useMemo(() => {
    const out = { inside: 0, outside: 0, stale: 0, other: 0 };
    for (const p of positions) {
      if (p.freshness === "stale") out.stale += 1;
      else if (p.inside_fence === true) out.inside += 1;
      else if (p.inside_fence === false) out.outside += 1;
      else out.other += 1;
    }
    return out;
  }, [positions]);

  const selected = useMemo(
    () => positions.find((p) => p.employee_id === selectedId) || null,
    [positions, selectedId]
  );

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-[19px] font-semibold text-ink">
            Live Map
            <LivePill label={`${REFRESH_MS / 1000}s`} />
          </h1>
          <p className="text-[12.5px] text-ink-dim">
            Last known position for everyone who has reported one, over your active fences.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={filters.department_id || ""}
            onChange={(e) => setParam("department_id", e.target.value)}
            aria-label="Filter by department"
            className="rounded-pill border border-line bg-surface px-3 py-1.5 text-[12.5px] text-ink-dim outline-none focus:border-brand/50"
          >
            <option value="">All departments</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={refresh}
            className="flex items-center gap-1.5 rounded-pill border border-line bg-surface px-3 py-1.5 text-[12.5px] font-semibold text-ink-dim transition hover:border-brand/40 hover:text-ink"
          >
            <RefreshCw size={13} />
            Refresh
          </button>
        </div>
      </header>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,2.1fr)_minmax(0,1fr)]">
        {error ? (
          <Card title="Live map">
            <ErrorState error={error} onRetry={load} />
          </Card>
        ) : (
          <LiveMap
            positions={positions}
            fences={fences}
            selectedId={selectedId}
            onSelect={(p) => setSelectedId(p.employee_id)}
          />
        )}

        <div className="space-y-3">
          <Card title="Right now" subtitle={lastUpdated ? `Updated ${ago(lastUpdated)}` : "Loading…"}>
            <div className="grid grid-cols-2 gap-2">
              <Stat label="Inside a fence" value={counts.inside} tone="ok" />
              <Stat label="Outside" value={counts.outside} tone="warn" />
              <Stat label="Stale fix" value={counts.stale} tone="neutral" />
              <Stat label="No fence" value={counts.other} tone="neutral" />
            </div>

            <ul className="mt-3 space-y-1.5">
              {LEGEND.map((item) => (
                <li key={item.label} className="flex items-center gap-2 text-[12px] text-ink-dim">
                  <span
                    aria-hidden="true"
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: item.color }}
                  />
                  {item.label}
                </li>
              ))}
            </ul>
          </Card>

          <Card title="Selected" subtitle={selected ? selected.emp_code : null}>
            {selected ? (
              <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[12.5px]">
                <dt className="text-ink-dim">Name</dt>
                <dd className="font-medium text-ink">{selected.name}</dd>

                <dt className="text-ink-dim">Fence</dt>
                <dd className="text-ink">
                  {selected.inside_fence === true
                    ? selected.inside_fence_names?.join(", ") || "Inside"
                    : selected.inside_fence === false
                      ? "Outside"
                      : "None assigned"}
                </dd>

                <dt className="text-ink-dim">Fix age</dt>
                <dd className="text-ink">{ageLabel(selected.age_ms)}</dd>

                {selected.speed != null ? (
                  <>
                    <dt className="text-ink-dim">Speed</dt>
                    <dd className="text-ink">{(selected.speed * 3.6).toFixed(0)} km/h</dd>
                  </>
                ) : null}

                {selected.battery != null ? (
                  <>
                    <dt className="text-ink-dim">Battery</dt>
                    <dd className={cn("text-ink", selected.battery <= 20 && "font-semibold text-crit")}>
                      {selected.battery}%
                    </dd>
                  </>
                ) : null}
              </dl>
            ) : loading ? (
              <p className="text-[12.5px] text-ink-dim">Loading positions…</p>
            ) : positions.length === 0 ? (
              <EmptyState
                icon={Radio}
                title="No positions yet"
                hint="Once a device in the tracker app reports a location, it appears here."
                compact
              />
            ) : (
              <p className="text-[12.5px] text-ink-dim">Tap a pin on the map.</p>
            )}
          </Card>

          {counts.outside > 0 ? (
            <p className="flex items-start gap-1.5 rounded-tile border border-warn/40 bg-warn-tint px-3 py-2 text-[12px] text-ink">
              <AlertTriangle size={13} className="mt-0.5 shrink-0 text-warn" />
              {counts.outside} outside their assigned fence. Check whether that is a site visit before
              treating it as an excursion.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }) {
  return (
    <div
      className={cn(
        "rounded-tile px-2.5 py-2",
        tone === "ok" ? "bg-ok-tint" : tone === "warn" ? "bg-warn-tint" : "bg-surface-2"
      )}
    >
      <p
        className={cn(
          "text-[19px] font-semibold leading-tight",
          tone === "ok" ? "text-ok" : tone === "warn" ? "text-warn" : "text-ink"
        )}
      >
        {value}
      </p>
      <p className="text-[11px] text-ink-dim">{label}</p>
    </div>
  );
}

function ago(timestamp) {
  const seconds = Math.round((Date.now() - timestamp) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  return `${minutes} min ago`;
}

function ageLabel(ageMs) {
  if (ageMs == null) return "never reported";
  const minutes = Math.floor(ageMs / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  return `${Math.floor(minutes / 60)} h ago`;
}