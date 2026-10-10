import { EmptyState } from "./EmptyState";
import { cn } from "@/lib/utils";

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

export default ErrorState;
