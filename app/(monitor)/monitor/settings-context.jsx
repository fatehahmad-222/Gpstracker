"use client";

import { createContext, useContext } from "react";

/**
 * Monitor module context: role, company code, timezone and the per-company
 * `settings` blob (min Android version, refresh interval, map quotas, risk
 * weights). Server components resolve this and hand it down through the
 * layout, so client pages never re-fetch it.
 */
const MonitorContext = createContext(null);

export function MonitorSettingsProvider({ value, children }) {
  return <MonitorContext.Provider value={value}>{children}</MonitorContext.Provider>;
}

export function useMonitor() {
  const ctx = useContext(MonitorContext);
  if (!ctx) {
    throw new Error("useMonitor must be used inside the monitor layout");
  }
  return ctx;
}

/** Company settings with defaults applied, so callers never deal with undefined. */
export function useCompanySettings() {
  const { settings = {} } = useMonitor();
  return {
    minAndroidVersion: Number(settings.min_android_version ?? 14),
    refreshIntervalMs: Number(settings.refresh_interval_ms ?? 30000),
    retentionDays: Number(settings.retention_days ?? 90),
    lateGraceMinutes: Number(settings.late_grace_minutes ?? 15),
    mapQuotas: {
      search: 200,
      map_action: 25,
      keystroke: 100,
      map_pin: 200,
      ...(settings.map_quotas || {}),
    },
    riskWeights: settings.risk_weights || {},
  };
}