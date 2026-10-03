"use client";

import { useMemo } from "react";
import { MapContainer, Marker, Polyline, Popup } from "react-leaflet";
import L from "leaflet";
import { FitBounds, OsmTiles, targetIcon } from "./MapBase";

const startIcon = L.divIcon({
  className: "",
  html: '<div style="width:12px;height:12px;border-radius:9999px;background:rgb(var(--accent));border:3px solid rgb(var(--bg));box-shadow:0 2px 8px rgb(0 0 0 / 0.45)"></div>',
  iconSize: [12, 12],
  iconAnchor: [6, 6],
});

const endIcon = L.divIcon({
  className: "",
  html: '<div style="width:16px;height:16px;border-radius:9999px;background:rgb(var(--info));border:3px solid rgb(var(--bg));box-shadow:0 2px 8px rgb(0 0 0 / 0.45)"></div>',
  iconSize: [16, 16],
  iconAnchor: [8, 8],
});

export default function HistoryMap({ locations = [], tasks = [], live = null, fitKey }) {
  const path = useMemo(() => locations.map((l) => [l.lat, l.lng]), [locations]);

  const bounds = useMemo(() => {
    const pts = path.map((p) => p);
    tasks.forEach((t) => pts.push([t.target_lat, t.target_lng]));
    if (live) pts.push([live.lat, live.lng]);
    return pts;
  }, [path, tasks, live]);

  const first = locations[0];
  const last = locations[locations.length - 1];

  return (
    <MapContainer center={[31.5497, 74.3436]} zoom={13} scrollWheelZoom className="h-full w-full">
      <OsmTiles />
      <FitBounds bounds={bounds} fitKey={fitKey ?? `${path.length}:${tasks.length}`} />

      {path.length > 1 && (
        <Polyline
          positions={path}
          pathOptions={{
            color: "rgb(var(--accent))",
            weight: 3,
            opacity: 0.9,
            dashArray: "1 0",
            lineCap: "round",
          }}
        />
      )}

      {first && <Marker position={[first.lat, first.lng]} icon={startIcon} />}
      {last && last !== first && <Marker position={[last.lat, last.lng]} icon={endIcon} />}

      {tasks.map((task) => (
        <Marker
          key={`t-${task.id}`}
          position={[task.target_lat, task.target_lng]}
          icon={targetIcon(true, task.status === "cancelled")}
        >
          <Popup>
            <div className="max-w-[200px]">
              <div className="text-sm font-semibold text-ink">{task.title}</div>
              <div className="mt-0.5 text-xs text-ink-dim">
                {task.status.replace("_", " ")} · radius {Math.round(task.radius_meters)} m
              </div>
            </div>
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}
