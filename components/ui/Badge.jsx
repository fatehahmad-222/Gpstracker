import { cn } from "@/lib/utils";
import { TASK_STATUS_META } from "@/lib/constants";

const variants = {
  accent: "bg-accent/12 text-accent border-accent/25",
  info: "bg-info/12 text-info border-info/25",
  warning: "bg-warning/12 text-warning border-warning/25",
  danger: "bg-danger/12 text-danger border-danger/25",
  dim: "bg-surface-3 text-ink-dim border-line",
};

export function Badge({ variant = "dim", className, children }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-pill border px-2.5 py-0.5 text-[11px] font-medium",
        variants[variant],
        className
      )}
    >
      {children}
    </span>
  );
}

export function StatusBadge({ status }) {
  const meta = TASK_STATUS_META[status] ?? TASK_STATUS_META.pending;
  const variant =
    status === "completed"
      ? "accent"
      : status === "in_progress"
      ? "info"
      : status === "pending"
      ? "warning"
      : "dim";
  return (
    <Badge variant={variant}>
      <span className={cn("h-1.5 w-1.5 rounded-full", meta.dot)} />
      {meta.label}
    </Badge>
  );
}

export function GeoBadge({ source }) {
  if (!source) return null;
  return (
    <Badge variant={source === "geofence" ? "info" : "dim"}>
      {source === "geofence" ? "auto-completed (geofence)" : "completed manually"}
    </Badge>
  );
}
