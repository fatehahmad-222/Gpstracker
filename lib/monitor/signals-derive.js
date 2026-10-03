/**
 * Derived signals — the checks that cannot be answered by counting rows in
 * `device_events` because they compare device state against a threshold or a
 * policy setting.
 *
 * Pure functions so the Command Center, the Dashboard and the tests all agree.
 */

import { haversineMeters } from "./geofence";

export const DEFAULT_MIN_ANDROID = 14;
export const NO_SYNC_AFTER_HOURS = 24;

/** Parse "13", "13.0", "13.0.0", "Android 13" into a comparable number. */
export function parseAndroidVersion(value) {
  if (value == null) return null;
  const match = String(value).match(/(\d+)/);
  return match ? Number(match[1]) : null;
}

export function isUnsupported(androidVersion, minVersion = DEFAULT_MIN_ANDROID) {
  const parsed = parseAndroidVersion(androidVersion);
  if (parsed == null) return false; // unknown is not "unsupported"
  return parsed < minVersion;
}

/** Days since the last successful sync; Infinity when never synced. */
export function hoursSinceSync(lastSyncAt, now = Date.now()) {
  if (!lastSyncAt) return Infinity;
  const t = new Date(lastSyncAt).getTime();
  if (Number.isNaN(t)) return Infinity;
  return (now - t) / 3600000;
}

export function noSyncOver24h(lastSyncAt, now = Date.now()) {
  return hoursSinceSync(lastSyncAt, now) >= NO_SYNC_AFTER_HOURS;
}

/** A second device signed in within the window. */
export function hasSecondDevice(events = [], now = Date.now(), windowHours = 24) {
  const cutoff = now - windowHours * 3600000;
  return events.some(
    (e) => e.type === "second_device" && new Date(e.occurred_at).getTime() >= cutoff
  );
}

/**
 * Impossible travel: implied speed between consecutive fixes above a
 * threshold. 90 km/h is generous for a foot patrol but well below a
 * vehicle teleport, which is the fraud pattern worth catching.
 */
export function impliedSpeedKmh(fromPing, toPing) {
  if (!fromPing || !toPing) return 0;
  const seconds =
    (new Date(toPing.recorded_at || toPing.ts).getTime() -
      new Date(fromPing.recorded_at || fromPing.ts).getTime()) / 1000;
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  const meters = haversineMeters(
    Number(fromPing.lat), Number(fromPing.lng),
    Number(toPing.lat), Number(toPing.lng)
  );
  return (meters / 1000 / seconds) * 3600;
}

export function detectImpossibleTravel(pings = [], thresholdKmh = 90) {
  const ordered = [...pings].sort(
    (a, b) =>
      new Date(a.recorded_at || a.ts).getTime() - new Date(b.recorded_at || b.ts).getTime()
  );
  for (let i = 1; i < ordered.length; i++) {
    const speed = impliedSpeedKmh(ordered[i - 1], ordered[i]);
    if (speed > thresholdKmh) {
      return {
        detected: true,
        speed_kmh: Math.round(speed),
        from: ordered[i - 1],
        to: ordered[i],
      };
    }
  }
  return { detected: false, speed_kmh: 0 };
}

/** Heartbeat gap: clocked in but silent for longer than the threshold. */
export function heartbeatGapMinutes(lastPingAt, now = Date.now(), thresholdMinutes = 15) {
  if (!lastPingAt) return Infinity;
  const mins = (now - new Date(lastPingAt).getTime()) / 60000;
  return mins >= thresholdMinutes ? mins : 0;
}

/** True when a fix was flagged as a mock location by the OS. */
export function isMockFix(ping) {
  return ping?.is_mock === true;
}

/**
 * Battery health for the "Device Health" dashboard card.
 * Below 20% the phone is likely to die mid-shift and stop reporting.
 */
export const LOW_BATTERY_PCT = 20;

export function batteryState(pct) {
  if (pct == null) return "unknown";
  if (pct < LOW_BATTERY_PCT) return "low";
  if (pct < 50) return "medium";
  return "ok";
}

/**
 * Build the derived half of an employee's signal counts.
 *
 * @param {object} employee   employees row
 * @param {object} device     device_profiles row (nullable)
 * @param {Array}  events     device_events rows within the window
 * @param {object} opts       { now, companySettings, lastPingAt }
 */
export function deriveSignals(employee, device, events = [], opts = {}) {
  const now = opts.now ?? Date.now();
  const settings = opts.companySettings || {};
  const minAndroid = Number(settings.min_android_version ?? DEFAULT_MIN_ANDROID);

  return {
    no_sync_24h: noSyncOver24h(device?.last_sync_at, now) ? 1 : 0,
    unsupported: isUnsupported(device?.android_version, minAndroid) ? 1 : 0,
    second_device: hasSecondDevice(events, now) ? 1 : 0,
    no_clock_in: employee ? (employee._noClockIn ? 1 : 0) : 0,
  };
}

/** Android version display: "Android 11" plus the model underneath. */
export function describeDevice(device, minVersion = DEFAULT_MIN_ANDROID) {
  if (!device) return { version: "—", model: null, supported: null };

  const raw = device.android_version;
  if (!raw) return { version: "Unknown", model: device.model || null, supported: null };

  const major = parseAndroidVersion(raw);
  const supported = major == null ? null : major >= minVersion;

  return {
    version: `Android ${raw.replace(/^android\s*/i, "")}`,
    model: device.model || device.manufacturer || null,
    supported,
  };
}