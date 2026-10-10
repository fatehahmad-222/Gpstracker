import { cn } from "@/lib/utils";

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
    <div className={cn("grid gap-3 sm:grid-cols-2 lg:grid-cols-3", className)} aria-busy="true">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="relative overflow-hidden rounded-card border border-line bg-surface p-4 shadow-mon">
          <span className="absolute inset-y-0 left-0 w-1 bg-surface-2" />
          <div className="flex items-start justify-between gap-3 pl-2">
            <div className="flex-1 space-y-2">
              <Skeleton className="h-2 w-20" />
              <Skeleton className="h-6 w-14" />
            </div>
            <Skeleton className="h-9 w-9 rounded-tile" />
          </div>
        </div>
      ))}
    </div>
  );
}
