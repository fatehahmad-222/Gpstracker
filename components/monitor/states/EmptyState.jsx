import { cn } from "@/lib/utils";

export function EmptyState({ icon: Icon, title, hint, action, className, compact = false }) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-card border border-line bg-surface text-center shadow-mon",
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

export default EmptyState;
