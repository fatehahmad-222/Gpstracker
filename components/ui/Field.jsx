import { cn } from "@/lib/utils";

export function Field({ label, hint, error, className, children }) {
  return (
    <label className={cn("block", className)}>
      {label && (
        <span className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-ink-dim">
          {label}
        </span>
      )}
      {children}
      {hint && !error && (
        <span className="mt-1.5 block text-xs text-ink-dim">{hint}</span>
      )}
      {error && (
        <span className="mt-1.5 block text-xs text-danger">{error}</span>
      )}
    </label>
  );
}
