import { cn } from "@/lib/utils";

function IconAlert({ size = 20, ...rest }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" {...rest}>
      <path d="M12 3 2.5 20h19L12 3Z" />
      <path d="M12 9v5" />
      <path d="M12 17.5h.01" />
    </svg>
  );
}

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

export default InlineError;
