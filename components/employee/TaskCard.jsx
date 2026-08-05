"use client";

import { motion } from "framer-motion";
import { CalendarClock, Flag, MapPin, Navigation, Play, Route } from "lucide-react";
import { StatusBadge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { formatDateTime, formatDistance, haversine } from "@/lib/utils";

function mapsDeepLink(lat, lng) {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
}

export function TaskCard({ task, position, onStart }) {
  const active = task.status === "pending" || task.status === "in_progress";
  const distance =
    position && active ? haversine(position.lat, position.lng, task.target_lat, task.target_lng) : null;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ type: "spring", damping: 26, stiffness: 300 }}
      className="rounded-card border border-line bg-surface p-4 shadow-card"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-display text-base font-semibold text-ink">{task.title}</h3>
          {task.description && (
            <p className="mt-1 line-clamp-2 text-sm text-ink-dim">{task.description}</p>
          )}
        </div>
        <StatusBadge status={task.status} />
      </div>

      <div className="mt-3 space-y-1.5 text-sm">
        <div className="flex items-center gap-2 text-ink-dim">
          <MapPin size={15} className="shrink-0" />
          <span className="truncate">{task.target_address || `${task.target_lat.toFixed(5)}, ${task.target_lng.toFixed(5)}`}</span>
        </div>
        {task.due_at && (
          <div className="flex items-center gap-2 text-ink-dim">
            <CalendarClock size={15} className="shrink-0" />
            <span>Due {formatDateTime(task.due_at)}</span>
          </div>
        )}
        {task.status === "completed" && task.completed_at && (
          <div className="flex items-center gap-2 text-accent">
            <Flag size={15} className="shrink-0" />
            <span>
              Completed {formatDateTime(task.completed_at)}
              {task.completion_source === "geofence" ? " · arrived on site" : " · manually"}
            </span>
          </div>
        )}
      </div>

      {active && (
        <div className="mt-3 flex items-center justify-between rounded-lg border border-line bg-surface-2 px-3 py-2.5">
          <div className="flex items-center gap-2 text-sm">
            <Route size={15} className="text-accent" />
            <span className="font-medium text-ink">
              {distance != null ? `${formatDistance(distance)} away` : "Distance unavailable"}
            </span>
            {distance != null && distance <= task.radius_meters && (
              <span className="rounded-pill bg-accent/15 px-2 py-0.5 text-xs font-medium text-accent">
                Inside radius — auto-completing
              </span>
            )}
          </div>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {active && (
          <Button
            variant="secondary"
            size="sm"
            href={mapsDeepLink(task.target_lat, task.target_lng)}
            target="_blank"
          >
            <Navigation size={14} /> Navigate
          </Button>
        )}
        <Button variant="ghost" size="sm" href={`/app/map?task=${task.id}`}>
          <MapPin size={14} /> View on map
        </Button>
        {task.status === "pending" && (
          <Button size="sm" onClick={() => onStart(task.id)} className="ml-auto">
            <Play size={14} /> Start
          </Button>
        )}
      </div>
    </motion.div>
  );
}

export function TaskEmptyHint() {
  return (
    <div className="rounded-card border border-dashed border-line px-6 py-10 text-center">
      <p className="text-sm font-medium text-ink">No tasks yet</p>
      <p className="mx-auto mt-1 max-w-xs text-sm text-ink-dim">
        When your admin assigns a task it will appear here instantly.
      </p>
    </div>
  );
}
