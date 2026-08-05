"use client";

import { motion } from "framer-motion";
import { MapPinOff, RefreshCcw } from "lucide-react";
import { useTracking } from "./EmployeeTracker";
import { formatDistance } from "@/lib/utils";
import { Button } from "@/components/ui/Button";

export function TrackingStatusPill() {
  const { status, accuracy, lastUpdate } = useTracking();

  if (status === "idle") return null;
  if (status === "tracking") {
    return (
      <div className="flex items-center gap-2 rounded-pill border border-accent/25 bg-accent/10 px-3 py-1.5">
        <span className="relative flex h-2 w-2">
          <span className="absolute inset-0 animate-pulseRing rounded-full bg-accent" />
          <span className="absolute inset-0 rounded-full bg-accent" />
        </span>
        <span className="text-xs font-medium text-accent">
          Live{accuracy != null ? ` · ±${formatDistance(accuracy)}` : ""}
        </span>
      </div>
    );
  }
  if (status === "denied") {
    return (
      <div className="flex items-center gap-2 rounded-pill border border-danger/30 bg-danger/10 px-3 py-1.5 text-xs font-medium text-danger">
        <MapPinOff size={14} />
        Permission denied
      </div>
    );
  }
  if (status === "error") {
    return (
      <div className="flex items-center gap-2 rounded-pill border border-warning/30 bg-warning/10 px-3 py-1.5 text-xs font-medium text-warning">
        <MapPinOff size={14} />
        Location error{lastUpdate ? " · stale" : ""}
      </div>
    );
  }
  return null;
}

export function TrackingBanner() {
  const { status, accuracy, lastUpdate, error, retry } = useTracking();

  if (status === "tracking") {
    return (
      <div className="flex items-center gap-3 rounded-card border border-accent/25 bg-accent/8 px-4 py-3">
        <span className="relative flex h-2.5 w-2.5 shrink-0">
          <span className="absolute inset-0 animate-pulseRing rounded-full bg-accent" />
          <span className="absolute inset-0 rounded-full bg-accent" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-medium text-accent">You’re being tracked live</p>
          <p className="truncate text-xs text-ink-dim">
            {accuracy != null && `Accuracy ±${formatDistance(accuracy)} · `}
            last fix {lastUpdate ? new Date(lastUpdate).toLocaleTimeString() : "—"}
          </p>
        </div>
      </div>
    );
  }

  if (status === "denied" || status === "error") {
    return (
      <motion.div
        initial={{ opacity: 0, y: -6 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center gap-3 rounded-card border border-danger/30 bg-danger/10 px-4 py-3"
      >
        <MapPinOff size={18} className="shrink-0 text-danger" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-danger">
            {status === "denied" ? "Location permission is blocked" : "Location unavailable"}
          </p>
          <p className="text-xs text-ink-dim">
            {error ||
              "Enable location access for this site in your browser settings, then retry."}
          </p>
        </div>
        <Button variant="danger" size="sm" onClick={retry}>
          <RefreshCcw size={14} /> Retry
        </Button>
      </motion.div>
    );
  }

  if (status === "unavailable") {
    return (
      <div className="rounded-card border border-line bg-surface-2 px-4 py-3 text-sm text-ink-dim">
        Geolocation isn’t supported in this browser, so live tracking is off.
      </div>
    );
  }

  return null;
}
