"use client";

import { useMemo } from "react";
import { MapContainer, Popup } from "react-leaflet";
import MarkerClusterGroup from "react-leaflet-cluster";
import Link from "next/link";
import { Radar, RefreshCcw, UserRound } from "lucide-react";
import L from "leaflet";
import AnimatedMarker from "@/components/map/AnimatedMarker";
import { FitBounds, FlyTo, OsmTiles } from "@/components/map/MapBase";
import { Avatar } from "@/components/ui/Avatar";
import { buildPinHtml, cn, colorForName, isOnline, timeAgo } from "@/lib/utils";
import { MARKER_COLORS, OFFLINE_AFTER_MS } from "@/lib/constants";

function markerIconFor(profile, opts) {
  const color = colorForName(profile.full_name, MARKER_COLORS);
  const html = buildPinHtml({
    name: profile.full_name,
    color,
    isOnline: opts.isOnline,
    hasTask: opts.hasTask,
    selected: opts.selected,
  });
  return L.divIcon({
    className: "",
    html,
    iconSize: [38, 38],
    iconAnchor: [19, 19],
  });
}

export default function OverviewMap({
  profiles,
  positions,
  tasks,
  selectedId,
  onSelect,
  focus,
  now,
  connection,
}) {
  const markers = useMemo(() => {
    return profiles
      .map((profile) => {
        const pos = positions[profile.id];
        if (!pos) return null;
        const hasTask = tasks.some((t) => t.employee_id === profile.id);
        const currentTask = tasks.find((t) => t.employee_id === profile.id);
        return {
          profile,
          pos,
          hasTask,
          currentTask,
        };
      })
      .filter(Boolean);
  }, [profiles, positions, tasks]);

  const bounds = useMemo(
    () => markers.map((m) => [m.pos.lat, m.pos.lng]),
    [markers]
  );

  return (
    <MapContainer center={[31.5497, 74.3436]} zoom={12} scrollWheelZoom className="h-full w-full">
      <OsmTiles />
      <FitBounds bounds={bounds} />

      {focus && <FlyTo center={[focus.lat, focus.lng]} />}

      <MarkerClusterGroup chunkedLoading>
        {markers.map(({ profile, pos, hasTask, currentTask }) => {
          const online = isOnline(pos.recorded_at, now, OFFLINE_AFTER_MS);
          const selected = profile.id === selectedId;
          const icon = markerIconFor(profile, { isOnline: online, hasTask, selected });
          return (
            <AnimatedMarker
              key={profile.id}
              position={[pos.lat, pos.lng]}
              icon={icon}
              eventHandlers={{ click: () => onSelect?.(profile.id) }}
            >
              <Popup>
                <div className="w-52">
                  <div className="flex items-center gap-2.5">
                    <Avatar name={profile.full_name} size={32} online={online} />
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-ink">
                        {profile.full_name || "Unnamed"}
                      </div>
                      <div
                        className={cn(
                          "text-xs",
                          online ? "text-accent" : "text-ink-dim"
                        )}
                      >
                        {online ? "Live" : "Offline"} · last seen {timeAgo(pos.recorded_at, now)}
                      </div>
                    </div>
                  </div>

                  {currentTask ? (
                    <div className="mt-2.5 rounded-lg border border-warning/25 bg-warning/10 px-2.5 py-1.5">
                      <div className="text-[10px] font-medium uppercase tracking-wider text-warning">
                        Active task
                      </div>
                      <div className="truncate text-xs font-medium text-ink">
                        {currentTask.title}
                      </div>
                    </div>
                  ) : (
                    <div className="mt-2.5 rounded-lg bg-surface-2 px-2.5 py-1.5 text-xs text-ink-dim">
                      No active task
                    </div>
                  )}

                  <div className="mt-2.5 flex items-center gap-2">
                    <button
                      onClick={() => onSelect?.(profile.id)}
                      className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-line bg-surface-2 px-2 py-1.5 text-xs font-medium text-ink transition-colors hover:bg-surface-3"
                    >
                      <Radar size={12} /> Focus
                    </button>
                    <Link
                      href={`/dashboard/employees/${profile.id}`}
                      className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-accent px-2 py-1.5 text-xs font-medium text-bg transition-colors hover:bg-accent-strong"
                    >
                      <UserRound size={12} /> Profile
                    </Link>
                  </div>
                </div>
              </Popup>
            </AnimatedMarker>
          );
        })}
      </MarkerClusterGroup>

      {markers.length === 0 && (
        <div className="pointer-events-none absolute inset-0 z-[500] flex items-center justify-center">
          <div className="rounded-card border border-line bg-surface/90 px-5 py-4 text-center shadow-pop backdrop-blur">
            <p className="text-sm font-medium text-ink">No employees reporting yet</p>
            <p className="mt-1 text-xs text-ink-dim">
              Positions appear here in real time once employees sign in.
            </p>
          </div>
        </div>
      )}

      {connection === "error" && (
        <div className="absolute left-1/2 top-3 z-[500] flex -translate-x-1/2 items-center gap-2 rounded-pill border border-warning/30 bg-surface/90 px-3 py-1.5 text-xs font-medium text-warning backdrop-blur">
          <RefreshCcw size={13} className="animate-spin" />
          Live feed reconnecting…
        </div>
      )}
    </MapContainer>
  );
}
