import { cn } from "@/lib/utils";

/**
 * Loading / empty / error states.
 *
 * Spec 9.2 item 3 explicitly forbids raw "Loading…" text, so every data region
 * in this module renders a skeleton instead, and empty states carry an icon,
 * a one-line explanation and a primary action.
 */

export function Skeleton({ className, ...rest }) {
  return <span className={cn("skeleton block rounded", className)} aria-hidden="true" {...rest} />;
}

export function TableSkeleton({ rows = 8, cols = 6 }) {
  return (
    <div className="space-y-2" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading data</span>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex gap-3">
          {Array.from({ length: cols }).map((__, c) => (
            <Skeleton key={c} className="h-8 flex-1" />
          ))}
        </div>
      ))}
    </div>
  );
}

export function CardSkeleton({ count = 4, className }) {
  return (
    <div className={cn("grid gap-3", className)} aria-busy="true">
      <span className="sr-only">Loading</span>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-card border border-line bg-surface p-4 shadow-mon">
          <div className="flex items-center gap-3">
            <Skeleton className="h-9 w-9 rounded-tile" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-6 w-16" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function StatSkeleton({ count = 6, className }) {
  return (
    <div className={cn("grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6", className)} aria-busy="true">
      <span className="sr-only">Loading</span>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-card border border-line bg-surface p-4 shadow-mon">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="mt-3 h-7 w-14" />
        </div>
      ))}
    </div>
  );
}

/**
 * @param {object} props
 * @param {string} props.title    one line explaining what is missing
 * @param {string} [props.hint]   optional secondary line
 * @param {React.ElementType} [props.icon]
 * @param {{label:string,onClick:Function}} [props.action]
 */
export function EmptyState({ title, hint, icon: Icon, action, className, compact = false }) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-card border border-dashed border-line bg-surface text-center",
        compact ? "px-4 py-6" : "px-6 py-12",
        className
      )}
    >
      {Icon ? (
        <span className="mb-3 grid h-11 w-11 place-items-center rounded-full bg-surface-2 text-ink-dim">
          <Icon size={20} strokeWidth={1.8} aria-hidden="true" />
        </span>
      ) : null}
      <p className="text-[13px] font-semibold text-ink">{title}</p>
      {hint ? <p className="mt-1 max-w-sm text-[12px] leading-relaxed text-ink-dim">{hint}</p> : null}
      {action ? (
        <button
          type="button"
          onClick={action.onClick}
          className="mt-4 rounded-pill bg-brand px-4 py-2 text-[12px] font-semibold text-white transition hover:bg-brand-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
        >
          {action.label}
        </button>
      ) : null}
    </div>
  );
}

/** The module's standard "Coming soon" placeholder for unopened sidebar items. */
export function ComingSoon({ label }) {
  return (
    <EmptyState
      title={`${label} is not available yet`}
      hint="This module exists in the navigation so the console is complete. It will be enabled once the corresponding workflow is implemented."
      icon={IconClock}
    />
  );
}

function IconClock({ size = 20, ...rest }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" {...rest}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

export function ErrorState({ title = "Could not load this data", hint, onRetry, className }) {
  return (
    <EmptyState
      title={title}
      hint={hint || "There was a problem talking to the server. Check your connection and try again."}
      icon={IconAlert}
      action={onRetry ? { label: "Try again", onClick: onRetry } : undefined}
      className={cn("border-crit/30 bg-crit-tint/40", className)}
    />
  );
}

function IconAlert({ size = 20, ...rest }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" {...rest}>
      <path d="M12 3 2.5 20h19L12 3Z" />
      <path d="M12 9v5" />
      <path d="M12 17.5h.01" />
    </svg>
  );
}

/** Inline banner for a non-blocking failure (one card failed, page still works). */
export function InlineError({ children, className }) {
  if (!children) return null;
  return (
    <div
      role="alert"
      className={cn(
        "flex items-start gap-2 rounded-tile border border-crit/30 bg-crit-tint px-3 py-2 text-[12px] text-crit",
        className
      )}
    >
      <IconAlert size={14} className="mt-0.5 shrink-0" />
      <span>{children}</span>
    </div>
  );
}