"use client";

import { Circle, MapContainer, Marker, Popup } from "react-leaflet";
import { useMemo } from "react";
import { Navigation } from "lucide-react";
import { FitBounds, FlyTo, OsmTiles, geofenceOptions, targetIcon } from "./MapBase";
import MyPositionMarker from "./MyPositionMarker";

const DEFAULT_CENTER = [31.5497, 74.3436];

function mapsDeepLink(lat, lng) {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
}

export default function EmployeeMap({ position, accuracy, tasks = [], focusTaskId }) {
  const focusTask = tasks.find((t) => t.id === focusTaskId);

  const bounds = useMemo(() => {
    const pts = [];
    if (position) pts.push([position.lat, position.lng]);
    tasks.forEach((t) => pts.push([t.target_lat, t.target_lng]));
    return pts;
  }, [position, tasks]);

  const center = focusTask
    ? [focusTask.target_lat, focusTask.target_lng]
    : position
    ? [position.lat, position.lng]
    : DEFAULT_CENTER;

  return (
    <MapContainer center={center} zoom={13} scrollWheelZoom className="h-full w-full">
      <OsmTiles />
      <FitBounds
        bounds={bounds}
        fitKey={`${focusTaskId ?? "all"}:${tasks.length}`}
      />
      {focusTask && <FlyTo center={[focusTask.target_lat, focusTask.target_lng]} />}
      <MyPositionMarker position={position} accuracy={accuracy} />

      {tasks.map((task) => {
        const active = task.status === "pending" || task.status === "in_progress";
        const pos = [task.target_lat, task.target_lng];
        return (
          <Marker key={task.id} position={pos} icon={targetIcon(active, !active)}>
            <Popup>
              <div className="min-w-[180px]">
                <div className="font-semibold text-ink">{task.title}</div>
                <div className="mt-0.5 text-xs text-ink-dim">
                  {task.status}
                  {active && ` · radius ${Math.round(task.radius_meters)} m`}
                </div>
                <a
                  href={mapsDeepLink(task.target_lat, task.target_lng)}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-accent"
                >
                  <Navigation size={12} /> Navigate
                </a>
              </div>
            </Popup>
          </Marker>
        );
      })}

      {tasks.map((task) =>
        task.status === "pending" || task.status === "in_progress" ? (
          <Circle
            key={`radius-${task.id}`}
            center={[task.target_lat, task.target_lng]}
            radius={Number(task.radius_meters)}
            pathOptions={geofenceOptions()}
          />
        ) : null
      )}
    </MapContainer>
  );
}
