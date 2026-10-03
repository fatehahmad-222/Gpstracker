"use client";

import { useMemo } from "react";
import { CircleMarker, MapContainer, Marker, Popup, Tooltip } from "react-leaflet";
import L from "leaflet";

import { OsmTiles, FitBounds } from "@/components/map/MapBase";
import { fenceBounds } from "@/lib/monitor/geojson";

/**
 * Live map: everyone who reported a position, over the company's fences.
 *
 * Colour encodes something an admin acts on rather than something decorative:
 *   green  — inside one of their assigned fences
 *   amber  — outside every assigned fence (an excursion, or a site visit)
 *   grey   — the fix is stale, so the position may be wrong
 *   hidden — older than an hour, or the employee is archived
 */

const FALLBACK_CENTER = [32.4945, 74.5229];

function markerColor(position) {
  if (position.freshness === "stale") return "#94a3b8";
  if (position.inside_fence === true) return "#16a34a";
  if (position.inside_fence === false) return "#f59e0b";
  // inside_fence === null means the employee has no fence assigned at all.
  return "#64748b";
}

function initials(name) {
  return String(name || "?")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function positionIcon(position, selected) {
  const color = markerColor(position);

  return L.divIcon({
    className: "",
    html: `<span class="live-marker${selected ? " is-selected" : ""}" style="--pin:${color}">${initials(
      position.name
    )}</span>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  });
}

/** One employee. */
function EmployeeMarker({ position, selected, onSelect }) {
  return (
    <Marker
      position={[position.lat, position.lng]}
      icon={positionIcon(position, selected)}
      eventHandlers={{ click: () => onSelect?.(position) }}
    >
      <Popup>
        <div className="min-w-[180px] text-[12px]">
          <p className="text-[13px] font-semibold text-ink">{position.name}</p>
          <p className="font-mono text-ink-dim">{position.emp_code}</p>

          <dl className="mt-2 grid grid-cols-2 gap-x-2 gap-y-1">
            <dt className="text-ink-dim">Status</dt>
            <dd className="font-medium text-ink">
              {position.freshness === "stale"
                ? "Stale fix"
                : position.inside_fence === true
                  ? "Inside fence"
                  : position.inside_fence === false
                    ? "Outside fence"
                    : "No fence assigned"}
            </dd>

            {position.speed != null ? (
              <>
                <dt className="text-ink-dim">Speed</dt>
                <dd className="text-ink">{(position.speed * 3.6).toFixed(0)} km/h</dd>
              </>
            ) : null}

            {position.battery != null ? (
              <>
                <dt className="text-ink-dim">Battery</dt>
                <dd className="text-ink">{position.battery}%</dd>
              </>
            ) : null}

            <dt className="text-ink-dim">Fix age</dt>
            <dd className="text-ink">{formatAge(position.age_ms)}</dd>
          </dl>

          {position.inside_fence_names?.length ? (
            <p className="mt-2 text-ink-dim">At: {position.inside_fence_names.join(", ")}</p>
          ) : null}
        </div>
      </Popup>
    </Marker>
  );
}

export function formatAge(ageMs) {
  if (ageMs == null) return "never";
  const minutes = Math.floor(ageMs / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h`;
  return `${Math.floor(hours / 24)} d`;
}

/**
 * `positions` and `fences` come from the server already filtered and annotated;
 * this component only decides what is visible and where the viewport goes.
 */
export default function LiveMap({
  positions = [],
  fences = [],
  selectedId,
  onSelect,
  className = "h-[560px]",
}) {
  const bounds = useMemo(() => {
    const points = positions.map((p) => [p.lat, p.lng]);
    if (points.length) return points;
    const fitted = fences.map(fenceBounds).filter(Boolean);
    return fitted.length ? fitted.flat() : null;
  }, [positions, fences]);

  const center = useMemo(() => {
    if (!bounds) return FALLBACK_CENTER;
    const lats = bounds.filter((_, i) => i % 2 === 0);
    const lngs = bounds.filter((_, i) => i % 2 === 1);
    return [avg(lats), avg(lngs)];
  }, [bounds]);

  return (
    <div className={`overflow-hidden rounded-tile border border-line ${className}`}>
      <MapContainer center={center} zoom={12} className="h-full w-full" scrollWheelZoom>
        <OsmTiles />

        {/* Refit only when the set of people changes, never on every poll —
            otherwise the map fights the user for the viewport. */}
        <FitBounds
          bounds={bounds}
          fitKey={positions.map((p) => p.employee_id).sort().join(",")}
          maxZoom={15}
        />

        {fences.map((fence) =>
          fence.type === "circle" && fence.center_lat != null ? (
            <CircleMarker
              key={fence.id}
              center={[fence.center_lat, fence.center_lng]}
              radius={Math.max(6, Math.min(28, Math.sqrt(Number(fence.radius_m) || 50) * 1.6))}
              pathOptions={{
                color: fence.color || "#2563eb",
                weight: fence.id === selectedId ? 2.5 : 1,
                fillOpacity: 0.08,
              }}
            >
              <Tooltip sticky>{fence.name}</Tooltip>
            </CircleMarker>
          ) : null
        )}

        {positions.map((position) => (
          <EmployeeMarker
            key={position.employee_id}
            position={position}
            selected={position.employee_id === selectedId}
            onSelect={onSelect}
          />
        ))}
      </MapContainer>
    </div>
  );
}

function avg(values) {
  if (!values.length) return FALLBACK_CENTER[0];
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}