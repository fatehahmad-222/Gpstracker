import { EmptyState } from "./EmptyState";

function IconClock({ size = 20, ...rest }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" {...rest}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

export function ComingSoon({ label }) {
  return (
    <EmptyState
      title={`${label} is not available yet`}
      hint="This module exists in the navigation so the console is complete. It will be enabled once the corresponding workflow is implemented."
      icon={IconClock}
    />
  );
}

export default ComingSoon;
