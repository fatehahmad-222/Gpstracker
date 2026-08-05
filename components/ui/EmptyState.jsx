export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className = "",
}) {
  return (
    <div className={`flex flex-col items-center justify-center px-6 py-12 text-center ${className}`}>
      {Icon && (
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-line bg-surface-2 text-ink-dim">
          <Icon size={22} strokeWidth={1.75} />
        </div>
      )}
      <p className="text-sm font-medium text-ink">{title}</p>
      {description && (
        <p className="mt-1 max-w-sm text-sm text-ink-dim">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
