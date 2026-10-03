/**
 * Primitives for the GPS Work Force Monitor module.
 *
 * These wrap the project's existing `components/ui/*` rather than replacing
 * them, so the module shares one design system instead of introducing a second.
 * Everything is colour-agnostic: it reads the semantic tokens the `.mon` scope
 * re-declares, which is what lets the same component render in the light
 * module shell and the dark tracker shell.
 */

import { cn } from "@/lib/utils";

/**
 * The table needs TanStack's client-only hooks, so it lives in its own module
 * and is re-exported here to keep one import site for the module's primitives.
 */
export { DataTable, columnDef, num } from "./DataTable";

// ---------------------------------------------------------------------------
// Section label — tiny uppercase letter-spaced label with a divider
// ---------------------------------------------------------------------------

export function SectionLabel({ children, icon: Icon, className }) {
  return (
    <div className={cn("mb-3", className)}>
      <div className="flex items-center gap-2 text-label font-semibold uppercase text-brand">
        {Icon ? <Icon size={13} strokeWidth={2.2} aria-hidden="true" /> : null}
        <span>{children}</span>
      </div>
      <div className="mt-2 h-px w-full bg-line" aria-hidden="true" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Status pill — fully rounded, dot + label
// ---------------------------------------------------------------------------

const STATUS_STYLES = {
  active: "bg-brand-tint text-brand",
  present: "bg-brand-tint text-brand",
  on_time: "bg-brand-tint text-brand",
  green: "bg-brand-tint text-brand",
  inactive: "bg-crit-tint text-crit",
  absent: "bg-crit-tint text-crit",
  red: "bg-crit-tint text-crit",
  late: "bg-high-tint text-high",
  amber: "bg-high-tint text-high",
  half_day: "bg-brand-tint-2 text-brand-strong",
  neutral: "bg-surface-2 text-ink-dim",
  info: "bg-surface-2 text-info",
};

const STATUS_DOTS = {
  active: "bg-brand",
  present: "bg-brand",
  on_time: "bg-brand",
  green: "bg-brand",
  inactive: "bg-crit",
  absent: "bg-crit",
  red: "bg-crit",
  late: "bg-high",
  amber: "bg-high",
  half_day: "bg-brand-strong",
  neutral: "bg-ink-dim",
  info: "bg-info",
};

export function StatusPill({ status = "neutral", label, dot = true, className }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-pill px-2.5 py-1 text-[11px] font-semibold",
        STATUS_STYLES[status] || STATUS_STYLES.neutral,
        className
      )}
    >
      {dot ? (
        <span
          className={cn("h-1.5 w-1.5 shrink-0 rounded-full", STATUS_DOTS[status] || STATUS_DOTS.neutral)}
          aria-hidden="true"
        />
      ) : null}
      {label ?? status}
    </span>
  );
}

/** Spec 4.3 "OT Allowed / Geo Fencing" Yes-No pills. */
export function YesNoPill({ value, yesLabel = "Yes", noLabel = "No" }) {
  const on = value === true || value === "yes" || value === "Yes";
  return (
    <StatusPill
      status={on ? "active" : "inactive"}
      dot={false}
      label={on ? yesLabel : noLabel}
    />
  );
}

// ---------------------------------------------------------------------------
// Severity pill — CRITICAL · HIGH · MEDIUM
// ---------------------------------------------------------------------------

const SEVERITY_CLASSES = {
  critical: "bg-crit-tint text-crit",
  high: "bg-high-tint text-high",
  medium: "bg-med-tint text-med",
  low: "bg-surface-2 text-ink-dim",
};

/** `CRITICAL · DATA LOSS` — the alert tiles' two-part tag. */
export function SeverityPill({ severity = "medium", category, className }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-pill px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider",
        SEVERITY_CLASSES[severity] || SEVERITY_CLASSES.medium,
        className
      )}
    >
      {category ? (
        <>
          <span>{severity}</span>
          <span aria-hidden="true">·</span>
          <span>{category}</span>
        </>
      ) : (
        severity
      )}
    </span>
  );
}

// ---------------------------------------------------------------------------
// KPI card — icon, uppercase label, big mono numeral, thin accent
// ---------------------------------------------------------------------------

export function KpiCard({
  label,
  value,
  icon: Icon,
  accent = "brand",
  hint,
  loading = false,
  className,
}) {
  const accentBar = {
    brand: "bg-brand",
    green: "bg-brand",
    amber: "bg-high",
    orange: "bg-high",
    red: "bg-crit",
    blue: "bg-info",
    purple: "bg-[#8b5cf6]",
    teal: "bg-brand",
    slate: "bg-ink-dim",
  }[accent] || "bg-brand";

  const iconTone = {
    brand: "bg-brand-tint text-brand",
    green: "bg-brand-tint text-brand",
    amber: "bg-high-tint text-high",
    orange: "bg-high-tint text-high",
    red: "bg-crit-tint text-crit",
    blue: "bg-surface-2 text-info",
    purple: "bg-surface-2 text-[#7c3aed]",
    teal: "bg-brand-tint text-brand",
    slate: "bg-surface-2 text-ink-dim",
  }[accent] || "bg-brand-tint text-brand";

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-card border border-line bg-surface p-4 shadow-mon",
        className
      )}
    >
      <span className={cn("absolute inset-y-0 left-0 w-1", accentBar)} aria-hidden="true" />
      <div className="flex items-start justify-between gap-3 pl-2">
        <div className="min-w-0">
          <div className="text-label font-semibold uppercase text-ink-dim">{label}</div>
          <div className="mt-2 font-mono text-[28px] font-bold leading-none tracking-tight text-ink tabular-nums">
            {loading ? <span className="skeleton inline-block h-7 w-16 rounded" /> : (value ?? "—")}
          </div>
          {hint ? <div className="mt-1.5 text-[11px] text-ink-dim">{hint}</div> : null}
        </div>
        {Icon ? (
          <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-tile", iconTone)}>
            <Icon size={17} strokeWidth={2.1} aria-hidden="true" />
          </span>
        ) : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Alert tile — white tile with a coloured left border, per spec 2
// ---------------------------------------------------------------------------

export function AlertTile({
  severity = "high",
  category,
  title,
  hint,
  count,
  loading = false,
  href,
  onClick,
}) {
  const border = {
    critical: "border-l-crit",
    high: "border-l-high",
    medium: "border-l-med",
    low: "border-l-ink-dim",
  }[severity] || "border-l-high";

  const inner = (
    <>
      <div className="flex items-start justify-between gap-2">
        <SeverityPill severity={severity} category={category} />
        <span className="font-mono text-lg font-bold leading-none text-ink tabular-nums">
          {loading ? <span className="skeleton inline-block h-5 w-7 rounded" /> : (count ?? "—")}
        </span>
      </div>
      <div className="mt-2.5 text-[13px] font-semibold leading-snug text-ink">{title}</div>
      <div className="mt-1 text-[11px] leading-relaxed text-ink-dim">{hint}</div>
    </>
  );

  const className = cn(
    "group block w-full rounded-tile border border-line border-l-4 bg-surface p-3 text-left shadow-mon",
    "transition hover:border-brand/40 hover:shadow-pop focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2",
    border
  );

  if (href) {
    return (
      <a href={href} className={className}>
        {inner}
      </a>
    );
  }
  return (
    <button type="button" onClick={onClick} className={className}>
      {inner}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------

export function Card({ title, subtitle, action, live = false, children, className, bodyClassName }) {
  return (
    <section className={cn("rounded-card border border-line bg-surface shadow-mon", className)}>
      {(title || action) && (
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
              {live ? <LivePill /> : null}
            </div>
            {subtitle ? <p className="mt-0.5 text-[11px] text-ink-dim">{subtitle}</p> : null}
          </div>
          {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
        </header>
      )}
      <div className={cn("p-4", bodyClassName)}>{children}</div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Live indicator
// ---------------------------------------------------------------------------

export function LivePill({ label = "Live", className }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-pill bg-brand-tint px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-brand",
        className
      )}
    >
      <span className="relative flex h-1.5 w-1.5" aria-hidden="true">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand opacity-70" />
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-brand" />
      </span>
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Radio card — spec 2: selected = green border + pale green fill
// ---------------------------------------------------------------------------

export function RadioCard({ name, value, selected, onChange, title, description, disabled, icon: Icon }) {
  const id = `${name}-${value}`;
  return (
    <label
      htmlFor={id}
      className={cn(
        "flex cursor-pointer items-start gap-2.5 rounded-tile border p-3 transition",
        selected ? "border-brand bg-brand-tint" : "border-line bg-surface hover:border-brand/40",
        disabled && "cursor-not-allowed opacity-50"
      )}
    >
      <input
        id={id}
        type="radio"
        name={name}
        value={value}
        checked={Boolean(selected)}
        disabled={disabled}
        onChange={() => onChange?.(value)}
        className="mt-0.5 h-4 w-4 shrink-0 accent-[rgb(var(--brand))]"
      />
      <span className="min-w-0">
        <span className="flex items-center gap-1.5 text-[13px] font-semibold text-ink">
          {Icon ? <Icon size={14} aria-hidden="true" /> : null}
          {title}
        </span>
        {description ? (
          <span className="mt-0.5 block text-[11px] leading-snug text-ink-dim">{description}</span>
        ) : null}
      </span>
    </label>
  );
}

// ---------------------------------------------------------------------------
// Segmented control — spec 2
// ---------------------------------------------------------------------------

export function SegmentedControl({ name, value, options, onChange, size = "md", className }) {
  const pad = size === "sm" ? "px-2.5 py-1 text-[11px]" : "px-3.5 py-1.5 text-[13px]";
  return (
    <div
      role="radiogroup"
      aria-label={name}
      className={cn("inline-flex rounded-pill border border-line bg-surface-2 p-0.5", className)}
    >
      {options.map((opt) => {
        const optValue = typeof opt === "string" ? opt : opt.value;
        const optLabel = typeof opt === "string" ? opt : opt.label;
        const active = optValue === value;
        return (
          <button
            key={optValue}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange?.(optValue)}
            className={cn(
              "rounded-pill font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
              pad,
              active ? "bg-surface text-ink shadow-sm" : "text-ink-dim hover:text-ink"
            )}
          >
            {optLabel}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Progress bar — department attendance
// ---------------------------------------------------------------------------

export function ProgressBar({ value = 0, tone, className, label }) {
  const pct = Math.max(0, Math.min(100, Number(value) || 0));
  const bar = tone || (pct >= 80 ? "bg-brand" : pct >= 50 ? "bg-high" : "bg-crit");
  return (
    <div
      className={cn("h-1.5 w-full overflow-hidden rounded-pill bg-surface-2", className)}
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
    >
      <div className={cn("h-full rounded-pill transition-all", bar)} style={{ width: `${pct}%` }} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Count pill — e.g. the green "41 Employees" pill
// ---------------------------------------------------------------------------

export function CountPill({ children, tone = "brand", className }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-pill px-2.5 py-0.5 text-[11px] font-semibold",
        tone === "brand" && "bg-brand-tint text-brand",
        tone === "lavender" && "bg-surface-2 text-[#6d5bd0]",
        tone === "neutral" && "bg-surface-2 text-ink-dim",
        className
      )}
    >
      {children}
    </span>
  );
}

/**
 * Table cell value treatment, per spec 2: "zero values are rendered muted
 * grey; non-zero values are highlighted".
 */
export function SignalValue({ value, tone = "high" }) {
  const n = Number(value || 0);
  if (!n) return <span className="font-mono text-ink-dim tabular-nums">0</span>;
  return (
    <span
      className={cn(
        "inline-flex h-5 min-w-[22px] items-center justify-center rounded-pill px-1.5 font-mono text-[11px] font-bold tabular-nums",
        tone === "crit" ? "bg-crit text-white" : tone === "info" ? "bg-info text-white" : "bg-high text-white"
      )}
    >
      {n}
    </span>
  );
}

/** Initials avatar with a deterministic colour derived from the name. */
const AVATAR_TONES = [
  "bg-brand-tint text-brand-strong",
  "bg-surface-2 text-[#6d5bd0]",
  "bg-high-tint text-high",
  "bg-crit-tint text-crit",
  "bg-surface-2 text-info",
  "bg-brand-tint-2 text-brand",
];

export function NameAvatar({ name = "", size = 32, className }) {
  const initials = String(name)
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase() || "?";

  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  const tone = AVATAR_TONES[hash % AVATAR_TONES.length];

  const px = size <= 28 ? "text-[10px]" : size <= 36 ? "text-[12px]" : "text-sm";

  return (
    <span
      className={cn(
        "inline-grid shrink-0 place-items-center rounded-full font-semibold",
        tone,
        px,
        className
      )}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      {initials}
    </span>
  );
}