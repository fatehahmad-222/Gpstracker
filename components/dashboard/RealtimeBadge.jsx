"use client";

import { cn } from "@/lib/utils";

export default function RealtimeBadge({ status }) {
  const meta = {
    connecting: { label: "Connecting", color: "bg-warning", text: "text-warning" },
    live: { label: "Live", color: "bg-accent", text: "text-accent" },
    error: { label: "Reconnecting…", color: "bg-danger", text: "text-danger" },
  }[status] ?? {
    label: "Connecting",
    color: "bg-warning",
    text: "text-warning",
  };

  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 rounded-pill border border-line bg-surface px-3 py-1.5 text-xs font-medium",
        meta.text
      )}
      title="Realtime feed status"
    >
      <span className={cn("h-2 w-2 rounded-full", meta.color, status === "live" && "animate-pulse")} />
      {meta.label}
    </span>
  );
}
