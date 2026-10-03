"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { Archive, MapPinned, Pencil, Plus, Search, Users } from "lucide-react";

import { api, ApiError } from "@/lib/monitor/client";
import { useQueryState } from "@/hooks/monitor/useQueryState";
import { Card, DataTable, StatusPill, columnDef } from "@/components/monitor/primitives";
import { EmptyState, ErrorState } from "@/components/monitor/states";
import { FenceForm } from "./FenceForm";

const FenceMap = dynamic(() => import("./FenceMap"), {
  ssr: false,
  loading: () => (
    <div className="flex h-[420px] items-center justify-center rounded-tile border border-line bg-surface-2 text-[12.5px] text-ink-dim">
      Loading map…
    </div>
  ),
});

const TYPE_FILTERS = [
  { value: "", label: "All types" },
  { value: "circle", label: "Circle" },
  { value: "rectangle", label: "Rectangle" },
  { value: "polygon", label: "Polygon" },
  { value: "route", label: "Route" },
];

const TYPE_LABELS = {
  circle: "Circle",
  rectangle: "Rectangle",
  polygon: "Polygon",
  route: "Route",
};

/** One-line description of the shape, in the units an admin thinks in. */
function shapeSummary(fence) {
  if (fence.type === "circle") return `${fence.radius_m} m radius`;
  if (fence.type === "route") {
    return fence.distance_km
      ? `${fence.distance_km} km · ${fence.buffer_m} m corridor`
      : `${fence.buffer_m} m corridor`;
  }
  return fence.type === "rectangle" ? "Rectangle area" : "Drawn area";
}

/**
 * The locations/fences screen.
 *
 * `lockedType` is a prop rather than state so the Routes page reuses this whole
 * screen pinned to route fences instead of duplicating the list and the map.
 */
export function FenceManager({
  lockedType = "",
  title = "Locations",
  description = "Zones, routes and who is assigned to what.",
}) {
  const { values: filters, setParam } = useQueryState({ q: "", type: lockedType, status: "" });

  const type = lockedType || filters.type || "";
  const query = filters.q || "";
  const status = filters.status || "";

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [notice, setNotice] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (type) params.set("type", type);
      if (status) params.set("status", status);
      if (query) params.set("q", query);

      const qs = params.toString();
      setData(await api.get(`/api/monitor/geofences${qs ? `?${qs}` : ""}`));
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [type, status, query]);

  useEffect(() => {
    load();
  }, [load]);

  // Memoised so `selected` does not recompute on every render.
  const rows = useMemo(() => data?.rows || [], [data]);

  const selected = useMemo(
    () => rows.find((row) => row.id === selectedId) || null,
    [rows, selectedId]
  );

  const deactivate = useCallback(async (row) => {
    // Deactivate, not delete: presence checks and violations reference this
    // fence and have to keep explaining themselves afterwards.
    if (
      !window.confirm(
        `Deactivate "${row.name}"?\n\nIt stops matching anybody, but its history is kept.`
      )
    ) {
      return;
    }

    try {
      await api.delete(`/api/monitor/geofences/${row.id}`);
      setNotice({ message: `"${row.name}" was deactivated.` });
      load();
    } catch (err) {
      setNotice({
        tone: "warn",
        message: err instanceof ApiError ? err.message : "Could not deactivate this location",
      });
    }
  }, [load]);

  const columns = useMemo(
    () => [
      columnDef({
        header: "Name",
        cell: ({ row }) => (
          <span className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: row.original.color || "#2563eb" }}
            />
            <span className="font-medium text-ink">{row.original.name}</span>
          </span>
        ),
      }),
      columnDef({
        header: "Type",
        cell: ({ row }) => (
          <span className="text-ink-dim">{TYPE_LABELS[row.original.type] || row.original.type}</span>
        ),
      }),
      columnDef({
        header: "Shape",
        cell: ({ row }) => <span className="text-ink-dim">{shapeSummary(row.original)}</span>,
      }),
      columnDef({
        header: "Assigned",
        cell: ({ row }) => (
          <span className="inline-flex items-center gap-1 text-ink-dim">
            <Users size={12} />
            {row.original.employee_count || 0}
          </span>
        ),
      }),
      columnDef({
        header: "Status",
        cell: ({ row }) => <StatusPill status={row.original.status === "active" ? "active" : "inactive"} />,
      }),
      columnDef({
        header: "",
        cell: ({ row }) => (
          <div className="flex justify-end gap-1">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setEditing(row.original);
              }}
              aria-label={`Edit ${row.original.name}`}
              className="rounded-lg p-1.5 text-ink-dim transition hover:bg-surface-2 hover:text-brand"
            >
              <Pencil size={13} />
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                deactivate(row.original);
              }}
              aria-label={`Deactivate ${row.original.name}`}
              className="rounded-lg p-1.5 text-ink-dim transition hover:bg-surface-2 hover:text-crit"
            >
              <Archive size={13} />
            </button>
          </div>
        ),
      }),
    ],
    [deactivate]
  );

  function saved(message) {
    setEditing(null);
    setNotice({ message });
    load();
  }

  if (editing) {
    return <FenceForm fence={editing.id ? editing : undefined} onCancel={() => setEditing(null)} onSaved={saved} />;
  }

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[19px] font-semibold text-ink">{title}</h1>
          <p className="text-[12.5px] text-ink-dim">{description}</p>
        </div>
        <button
          type="button"
          onClick={() => setEditing({})}
          className="flex items-center gap-1.5 rounded-pill bg-brand px-3.5 py-1.5 text-[12.5px] font-semibold text-white transition hover:bg-brand-strong"
        >
          <Plus size={14} />
          New location
        </button>
      </header>

      {notice ? (
        <div
          role="status"
          className={`rounded-tile border px-3 py-2 text-[12.5px] font-medium ${
            notice.tone === "warn"
              ? "border-crit/40 bg-crit-tint text-crit"
              : "border-ok/30 bg-ok-tint text-ok"
          }`}
        >
          {notice.message}
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
        <Card
          title="Saved locations"
          subtitle={data?.total != null ? `${data.total} total` : null}
          action={
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search
                  size={13}
                  className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-dim"
                />
                <input
                  value={query}
                  onChange={(e) => setParam("q", e.target.value)}
                  placeholder="Search names"
                  aria-label="Search locations"
                  className="w-40 rounded-pill border border-line bg-surface py-1.5 pl-7 pr-3 text-[12.5px] text-ink outline-none transition placeholder:text-ink-dim focus:border-brand/50"
                />
              </div>

              {lockedType ? null : (
                <select
                  value={type}
                  onChange={(e) => setParam("type", e.target.value)}
                  aria-label="Filter by type"
                  className="rounded-pill border border-line bg-surface px-2.5 py-1.5 text-[12px] text-ink-dim outline-none focus:border-brand/50"
                >
                  {TYPE_FILTERS.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              )}

              <label className="flex cursor-pointer items-center gap-1.5 text-[12px] text-ink-dim">
                <input
                  type="checkbox"
                  checked={status === "inactive"}
                  onChange={(e) => setParam("status", e.target.checked ? "inactive" : "")}
                  className="h-3.5 w-3.5 accent-[rgb(var(--brand))]"
                />
                Inactive only
              </label>
            </div>
          }
        >
          <DataTable
            data={rows}
            columns={columns}
            loading={loading}
            error={error}
            onRetry={load}
            getRowId={(row) => row.id}
            onRowClick={(row) => setSelectedId((current) => (current === row.id ? null : row.id))}
            empty={
              <EmptyState
                icon={MapPinned}
                title="No locations yet"
                hint="Create a circle, rectangle, polygon or route to start matching attendance."
              />
            }
          />
        </Card>

        <div className="space-y-3">
          <FenceMap
            fences={rows}
            selectedId={selectedId}
            onSelect={(fence) => setSelectedId(fence.id)}
            className="h-[460px]"
          />
          {selected ? (
            <Card
              title={selected.name}
              subtitle={`${TYPE_LABELS[selected.type]} · ${shapeSummary(selected)}`}
            >
              <p className="text-[12.5px] text-ink-dim">
                {selected.employee_count || 0} employee
                {selected.employee_count === 1 ? "" : "s"} assigned. Assignment is managed from
                each employee&apos;s record.
              </p>
              {selected.description ? (
                <p className="mt-2 text-[12.5px] text-ink">{selected.description}</p>
              ) : null}
            </Card>
          ) : (
            <p className="px-1 text-[12px] text-ink-dim">
              Select a location to highlight it on the map.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}