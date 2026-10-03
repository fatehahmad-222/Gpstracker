"use client";

import { useEffect, useMemo } from "react";
import { Circle, MapContainer, Marker, Polygon, Polyline, Popup, Tooltip, useMapEvents } from "react-leaflet";
import L from "leaflet";

import { OsmTiles, FitBounds } from "@/components/map/MapBase";
import { fenceBounds, fenceCenter, fenceVertices } from "@/lib/monitor/geojson";

/** Sialkot, matching the seeded data. Used only when there is nothing to fit. */
const FALLBACK_CENTER = [32.4945, 74.5229];

function fenceStyle(fence, { active = false, dimmed = false } = {}) {
  const color = fence.color || "#2563eb";
  return {
    color: dimmed ? "#94a3b8" : color,
    weight: active ? 3 : 1.5,
    dashArray: fence.type === "route" ? "6 4" : undefined,
    fillColor: dimmed ? "#94a3b8" : color,
    // A route is a corridor, so it gets a faint fill to show the swept area.
    fillOpacity: active ? 0.22 : fence.type === "route" ? 0.1 : 0.14,
  };
}

/**
 * One fence, drawn by its type.
 *
 * The geometry always comes from the server-built GeoJSON, never from the
 * draw-in-progress points, so what is previewed and what gets saved are the
 * same numbers.
 */
function FenceShape({ fence, onSelect, selected }) {
  const style = fenceStyle(fence, { active: selected, dimmed: fence.status === "inactive" });
  const emit = (event) => {
    L.DomEvent.stopPropagation(event);
    onSelect?.(fence);
  };

  const geometry = fence.geometry || {};
  const coords = geometry.coordinates || [];

  if (fence.type === "circle" && fence.center_lat != null) {
    return (
      <Circle
        center={[fence.center_lat, fence.center_lng]}
        radius={Number(fence.radius_m) || 0}
        pathOptions={style}
        eventHandlers={{ click: emit }}
      >
        <Tooltip sticky>{fence.name}</Tooltip>
      </Circle>
    );
  }

  if (fence.type === "route") {
    return (
      <Polyline positions={coords} pathOptions={style} eventHandlers={{ click: emit }}>
        <Tooltip sticky>{fence.name}</Tooltip>
      </Polyline>
    );
  }

  // polygon and rectangle are both stored as a Polygon.
  if (!coords[0]) return null;

  return (
    <Polygon positions={coords[0]} pathOptions={style} eventHandlers={{ click: emit }}>
      <Tooltip sticky>{fence.name}</Tooltip>
    </Polygon>
  );
}

/** Label anchor for a fence, placed at its centre. */
function FenceLabel({ fence, onSelect, selected }) {
  const center = fenceCenter(fence);
  if (!center) return null;

  return (
    <Marker
      position={[center.lat, center.lng]}
      interactive
      eventHandlers={{ click: () => onSelect?.(fence) }}
      icon={L.divIcon({
        className: "",
        html: `<span class="fence-label${selected ? " is-selected" : ""}" style="--fence-color:${fence.color || "#2563eb"}">${escapeHtml(
          fence.name
        )}</span>`,
        iconSize: [0, 0],
      })}
    />
  );
}

/**
 * Click-to-pick and click-to-draw.
 *
 * `mode` decides what a click means:
 *   "none"      — selecting existing fences only
 *   "circle"    — drop a centre; the caller holds the radius
 *   "rectangle" — first corner, then the opposite corner
 *   "polygon"   — append a vertex
 *   "route"     — append a vertex along the path
 */
function DrawCatcher({ mode, onPick, active }) {
  const map = useMapEvents({
    click(event) {
      if (!active || !mode || mode === "none") return;
      onPick({ lat: event.latlng.lat, lng: event.latlng.lng });
    },
  });

  // The cursor has to say what a click will do, or drawing on a map is guesswork.
  useEffect(() => {
    const container = map.getContainer();
    container.style.cursor = active && mode && mode !== "none" ? "crosshair" : "";
    return () => {
      container.style.cursor = "";
    };
  }, [map, active, mode]);

  return null;
}

/** Undo/clear controls, rendered as a Leaflet control over the map. */
function DrawControls({ canUndo, onUndo, onClear }) {
  const map = useMapEvents({});

  // The hook has to run before any early return, or the effect below would be
  // called conditionally.
  useEffect(() => {
    if (!canUndo && !onClear) return undefined;

    const control = L.control({ position: "topright" });
    control.onAdd = () => {
      const div = L.DomUtil.create("div", "fence-draw-controls");
      div.innerHTML = `
        <button type="button" data-act="undo"${canUndo ? "" : " disabled"}>Undo point</button>
        <button type="button" data-act="clear">Clear</button>`;
      div.querySelector('[data-act="undo"]').onclick = () => onUndo?.();
      div.querySelector('[data-act="clear"]').onclick = () => onClear?.();
      return div;
    };

    map.addControl(control);
    return () => map.removeControl(control);
  }, [map, canUndo, onUndo, onClear]);

  return null;
}

/**
 * The geofence map.
 *
 * Read-only unless `drawMode` is set, in which case clicks build a shape that
 * is reported upward. Kept separate from the form so the same component serves
 * the list, the editor and the pick-on-map page.
 */
export default function FenceMap({
  fences = [],
  onSelect,
  selectedId,
  drawMode = "none",
  draft = null,
  onPick,
  onUndo,
  onClear,
  className = "h-[420px]",
}) {
  const bounds = useMemo(() => {
    const fitted = fences.map(fenceBounds).filter(Boolean);
    if (fitted.length) return fitted.flat();
    if (draft?.geometry) return fenceBounds({ ...draft, type: draft.type });
    return null;
  }, [fences, draft]);

  const center = useMemo(() => {
    const b = bounds;
    if (!b) return FALLBACK_CENTER;
    return [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
  }, [bounds]);

  return (
    <div className={`overflow-hidden rounded-tile border border-line ${className}`}>
      <MapContainer center={center} zoom={13} className="h-full w-full" scrollWheelZoom>
        <OsmTiles />
        <FitBounds bounds={bounds} fitKey={`${fences.length}:${draft?.type || ""}`} />

        {fences.map((fence) => (
          <FenceShape key={fence.id} fence={fence} onSelect={onSelect} selected={fence.id === selectedId} />
        ))}

        {fences.map((fence) => (
          <FenceLabel key={`label-${fence.id}`} fence={fence} onSelect={onSelect} selected={fence.id === selectedId} />
        ))}

        {/* The shape being drawn, rendered from the same builders that will save it. */}
        {draft?.geometry ? (
          <FenceShape fence={{ ...draft, id: "draft", color: "#0ea5e9" }} selected />
        ) : null}

        <DrawCatcher mode={drawMode} onPick={onPick} active={Boolean(onPick)} />
        <DrawControls canUndo={Boolean(draft) && drawMode !== "circle"} onUndo={onUndo} onClear={onClear} />
      </MapContainer>
    </div>
  );
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (c) => {
    switch (c) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}

export { fenceVertices };