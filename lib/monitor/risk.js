/**
 * Risk scoring.
 *
 * A configurable weighted sum of signal counts. Weights live in
 * `companies.settings.risk_weights` (migration 0003) so an admin can retune
 * scoring without a code change.
 *
 * IMPORTANT: the reference product's actual formula is unknown. The defaults
 * here were chosen to roughly reproduce two observed rows:
 *   - an employee whose only signal was `unsupported` scored 5
 *   - an employee with 1 force-stop + 2 auto clock-outs scored 11
 * Auto clock-out is derived (1.5 x 2 = 3) plus force-stop (4) = 7, and the
 * remaining 4 in that row is assumed to be an auto_time_off-class signal the
 * video did not label clearly. Any exact reading of the video is a guess.
 */

import { activeSignalKeys } from "./signals";

/** Mirrors companies.settings.risk_weights in migration 0003. */
export const DEFAULT_RISK_WEIGHTS = {
  unsupported: 5,
  force_stop: 4,
  auto_clock_out: 1.5,
  second_device: 4,
  data_cleared: 8,
  logged_in_not_synced: 8,
  fake_gps: 10,
  impossible_travel: 9,
  out_of_zone: 3,
  heartbeat_gap: 2,
  no_clock_in: 1,
  auto_time_off: 4,
  time_diff: 3,
  location_off: 2,
  power_off: 2,
  battery_restrict: 2,
  dead_zone: 1,
  developer_mode: 3,
  logged_out: 2,
  admin_logout: 1,
  sim_change: 5,
  old_app: 1,
  battery_low: 1,
};

/** Bands drive the Risk pill colour. */
export const RISK_BANDS = [
  { max: 0, key: "none", label: "Clean", className: "bg-surface-2 text-ink-dim" },
  { max: 4, key: "low", label: "Low", className: "bg-brand-tint text-brand" },
  { max: 9, key: "medium", label: "Medium", className: "bg-high-tint text-high" },
  { max: Infinity, key: "high", label: "High", className: "bg-crit-tint text-crit" },
];

export function riskBand(score) {
  return RISK_BANDS.find((b) => score <= b.max) || RISK_BANDS[RISK_BANDS.length - 1];
}

/** Round to one decimal but drop a trailing `.0` — "11" not "11.0". */
function tidy(n) {
  return Math.round(n * 10) / 10;
}

export function resolveWeights(companySettings = {}) {
  const configured = companySettings?.risk_weights;
  if (!configured || typeof configured !== "object") return { ...DEFAULT_RISK_WEIGHTS };

  const weights = { ...DEFAULT_RISK_WEIGHTS };
  for (const key of Object.keys(DEFAULT_RISK_WEIGHTS)) {
    const value = Number(configured[key]);
    if (Number.isFinite(value) && value >= 0) weights[key] = value;
  }
  return weights;
}

/**
 * Weighted sum of signal counts.
 *
 * @param {object} counts  signal key -> occurrence count
 * @param {object} weights resolved weight table
 * @returns {{ score: number, contributions: Array<{key,count,weight,subtotal}> }}
 */
export function computeRisk(counts = {}, weights = DEFAULT_RISK_WEIGHTS) {
  const contributions = [];
  let total = 0;

  // Iterate the *weight table*, not SIGNAL_KEYS: derived signals (auto clock-out,
  // no clock-in) are scored without having a matching column in the event table,
  // so keying off SIGNAL_KEYS would silently drop their weights.
  for (const key of new Set([...Object.keys(weights), ...Object.keys(counts || {})])) {
    const count = Number((counts || {})[key] || 0);
    if (!(count > 0)) continue;
    const weight = Number(weights[key] ?? 0);
    if (!Number.isFinite(weight) || weight <= 0) continue;
    const subtotal = weight * count;
    total += subtotal;
    contributions.push({ key, count, weight, subtotal: tidy(subtotal) });
  }

  contributions.sort((a, b) => b.subtotal - a.subtotal);
  return { score: tidy(total), contributions };
}

/**
 * Reason list for the expanded event panel: the top weighted signals with a
 * plain-English explanation.
 */
export function riskReasons(counts = {}, weights = DEFAULT_RISK_WEIGHTS, limit = 3) {
  const { contributions } = computeRisk(counts, weights);
  return contributions.slice(0, limit);
}

export function isFlagged(counts = {}) {
  return activeSignalKeys(counts).length > 0;
}