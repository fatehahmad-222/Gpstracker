import { describe, it, expect } from "vitest";

import { tokenStatus, canIngest, relativeTime, TOKEN_STATUS } from "@/lib/monitor/devices";

const NOW = new Date("2026-10-04T12:00:00Z").getTime();
const at = (offsetMs) => new Date(NOW + offsetMs).toISOString();

describe("tokenStatus", () => {
  it("treats a fresh token as active", () => {
    expect(tokenStatus({ created_at: at(-86_400_000) }, NOW)).toBe("active");
  });

  it("treats a token with no expiry as active", () => {
    expect(tokenStatus({ expires_at: null }, NOW)).toBe("active");
  });

  it("treats a revoked token as revoked", () => {
    expect(tokenStatus({ revoked_at: at(-60_000) }, NOW)).toBe("revoked");
  });

  it("treats a past expiry as expired", () => {
    expect(tokenStatus({ expires_at: at(-1) }, NOW)).toBe("expired");
  });

  it("treats a future expiry as still active", () => {
    expect(tokenStatus({ expires_at: at(86_400_000) }, NOW)).toBe("active");
  });

  it("treats the exact expiry instant as expired", () => {
    // Inclusive, so a token is dead the moment it lapses rather than a ms later.
    expect(tokenStatus({ expires_at: at(0) }, NOW)).toBe("expired");
  });

  it("prefers revoked over expired", () => {
    // A revoked token was turned off deliberately after reporting a lost phone.
    // Labelling it merely "expired" would understate that.
    expect(tokenStatus({ revoked_at: at(-86_400_000), expires_at: at(-86_400_000) }, NOW)).toBe("revoked");
  });

  it("handles a missing row", () => {
    expect(tokenStatus(undefined, NOW)).toBe("active");
    expect(tokenStatus({}, NOW)).toBe("active");
  });

  it("has a label and pill tone for every state it can return", () => {
    for (const state of ["active", "revoked", "expired"]) {
      expect(TOKEN_STATUS[state].label).toBeTruthy();
      expect(TOKEN_STATUS[state].status).toBeTruthy();
    }
  });
});

describe("canIngest", () => {
  it("is true only for an active token", () => {
    expect(canIngest({}, NOW)).toBe(true);
    expect(canIngest({ revoked_at: at(-1) }, NOW)).toBe(false);
    expect(canIngest({ expires_at: at(-1) }, NOW)).toBe(false);
  });
});

describe("relativeTime", () => {
  it("says Never for a device that has never synced", () => {
    // Distinct from a blank cell: enrolled-but-never-synced is a problem in
    // itself, and an enrolled device whose phone died looks identical without it.
    expect(relativeTime(null, NOW)).toBe("Never");
    expect(relativeTime(undefined, NOW)).toBe("Never");
    expect(relativeTime("", NOW)).toBe("Never");
  });

  it("says Never for an unparseable value rather than NaN ago", () => {
    expect(relativeTime("not a date", NOW)).toBe("Never");
  });

  it("collapses the last minute to Just now", () => {
    expect(relativeTime(at(-5_000), NOW)).toBe("Just now");
    expect(relativeTime(at(-59_000), NOW)).toBe("Just now");
  });

  it("tolerates a server clock ahead of the browser", () => {
    // last_used_at is written by the server, so it can legitimately be a few
    // seconds in the future relative to this machine.
    expect(relativeTime(at(5_000), NOW)).toBe("Just now");
  });

  it("scales through minutes, hours and days", () => {
    expect(relativeTime(at(-5 * 60_000), NOW)).toBe("5m ago");
    expect(relativeTime(at(-3 * 3_600_000), NOW)).toBe("3h ago");
    expect(relativeTime(at(-2 * 86_400_000), NOW)).toBe("2d ago");
  });

  it("does not round up across a unit boundary", () => {
    // 119 minutes is "1h ago", not "2h ago".
    expect(relativeTime(at(-119 * 60_000), NOW)).toBe("1h ago");
    expect(relativeTime(at(-120 * 60_000), NOW)).toBe("2h ago");
  });
});