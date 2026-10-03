"use client";

import { useEffect } from "react";
import { TileLayer, useMap } from "react-leaflet";
import L from "leaflet";

export function OsmTiles() {
  return (
    <TileLayer
      attribution='&copy; <a href="https://www.esri.com">Esri</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
      url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}"
    />
  );
}

/**
 * Fits the viewport to `bounds`.
 *
 * Two things this deliberately does NOT do:
 *  - Depend on the `padding` array identity. A fresh `[50, 50]` default is a new
 *    reference every render, which made the effect (and therefore fitBounds)
 *    run on every render, so the map fought the user for control of the viewport.
 *  - Refit whenever `bounds` changes. On a live fleet map bounds change every
 *    time a position streams in, so panning was impossible.
 *
 * Callers pass `fitKey`: refit happens only when that changes (an employee joins
 * or leaves, the date range changes, a task is focused).
 */
export function FitBounds({ bounds, padding = [50, 50], maxZoom = 16, fitKey }) {
  const map = useMap();
  const paddingKey = Array.isArray(padding) ? padding.join(",") : String(padding);
  const key =
    fitKey ?? (bounds && bounds.length > 0 ? bounds.map((b) => b.join(",")).join("|") : "");

  useEffect(() => {
    if (!bounds || bounds.length === 0) return;
    map.fitBounds(L.latLngBounds(bounds), { padding, maxZoom });
  }, [map, key, maxZoom, paddingKey]);

  return null;
}

export function FlyTo({ center, zoom = 15 }) {
  const map = useMap();
  const key = center ? center.join(",") : "";

  useEffect(() => {
    if (!center) return;
    map.flyTo(center, zoom, { duration: 1.1 });
  }, [map, key, zoom]);

  return null;
}

/** Marker used to show a task's target location. */
export function targetIcon(active = true, dimmed = false) {
  return L.divIcon({
    className: "",
    html: `<div class="fleet-target" style="${dimmed ? "opacity:0.45" : ""}"></div>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  });
}

/** Circle options for a task geofence. */
export function geofenceOptions() {
  return {
    color: "rgb(var(--danger))",
    weight: 1.5,
    dashArray: "4 4",
    fillColor: "rgb(var(--danger))",
    fillOpacity: 0.1,
  };
}
