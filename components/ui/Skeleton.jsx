import { cn } from "@/lib/utils";

export function Skeleton({ className }) {
  return <div className={cn("skeleton rounded-lg", className)} />;
}

export function SkeletonText({ lines = 3, className }) {
  return (
    <div className={cn("space-y-2", className)}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className="h-3.5" />
      ))}
    </div>
  );
}

export function SkeletonCard({ className }) {
  return (
    <div className={cn("rounded-card border border-line bg-surface p-4", className)}>
      <Skeleton className="mb-3 h-4 w-1/3" />
      <SkeletonText lines={3} />
    </div>
  );
}
