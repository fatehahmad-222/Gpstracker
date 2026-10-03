/**
 * Device enrolment presentation rules.
 *
 * Kept out of the component so the state machine can be tested directly: the
 * distinction between revoked, expired and never-used is the part that is easy to
 * get subtly wrong and awkward to verify through a rendered table.
 */

export const TOKEN_STATUS = {
  active: { label: "Active", status: "ok" },
  revoked: { label: "Revoked", status: "danger" },
  expired: { label: "Expired", status: "neutral" },
};

/**
 * Which of the three states a token is in.
 *
 * Revoked wins over expired: a revoked token is the deliberate outcome of someone
 * reporting a lost phone, and showing it as merely "expired" would understate that
 * it was turned off on purpose.
 */
export function tokenStatus(row = {}, now = Date.now()) {
  if (row.revoked_at) return "revoked";
  if (row.expires_at && new Date(row.expires_at).getTime() <= now) return "expired";
  return "active";
}

/** Can this token still post telemetry? */
export function canIngest(row, now = Date.now()) {
  return tokenStatus(row, now) === "active";
}

/**
 * "Last sync" as a supervisor reads it.
 *
 * Null is "Never" rather than a blank cell because an enrolled device that has
 * never synced is a different and more urgent fact than one that synced recently.
 */
export function relativeTime(value, now = Date.now()) {
  if (!value) return "Never";

  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return "Never";

  const ms = now - then;
  // A heartbeat written by a server slightly ahead of this browser's clock.
  if (ms < 60_000) return "Just now";

  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins}m ago`;

  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;

  return `${Math.floor(hours / 24)}d ago`;
}