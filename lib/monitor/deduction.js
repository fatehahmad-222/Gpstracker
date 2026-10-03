/**
 * Late / early deduction engine — the shared maths behind the
 * "Late / Early deduction Form" policy type (spec 4.4A) and the payroll maths.
 *
 * Pure functions; unit tested in tests/unit/deduction.test.js.
 */

export const DEDUCTION_METHODS = ["fixed", "per_minute", "salary_based"];

/** Company-wide fallback when a policy omits a value. */
export const DEFAULTS = {
  graceMinutes: 15,
  maxDeduction: null, // null = uncapped
  warnAfter: 5,
  dailySalaryDivisor: 30,
};

/**
 * How many minutes are chargeable.
 *
 * `lateMinutes` is already grace-adjusted by deriveDay(), but a policy may
 * override the grace period, so it is applied here when not pre-adjusted.
 */
export function chargeableMinutes(lateMinutes, graceMinutes = DEFAULTS.graceMinutes) {
  const late = Number(lateMinutes || 0);
  if (late <= 0) return 0;
  return Math.max(0, late - Number(graceMinutes || 0));
}

/**
 * Compute one occurrence's deduction.
 *
 * @param {object} args
 * @param {number} args.lateMinutes     minutes late (before grace)
 * @param {string} args.method          fixed | per_minute | salary_based
 * @param {number} [args.amount]        PKR amount, for fixed / per_minute
 * @param {number} [args.basicSalary]   PKR, required for salary_based
 * @param {number} [args.graceMinutes]
 * @param {number} [args.maxDeduction]
 * @returns {{ minutes:number, amount:number, capped:boolean, cappedAt:number|null }}
 */
export function computeDeduction({
  lateMinutes,
  method = "fixed",
  amount = 0,
  basicSalary = 0,
graceMinutes = DEFAULTS.graceMinutes,
  maxDeduction = DEFAULTS.maxDeduction,
  dailySalaryDivisor = DEFAULTS.dailySalaryDivisor,
  plannedShiftMinutes = 480,
} = {}) {
  const minutes = chargeableMinutes(lateMinutes, graceMinutes);
  if (minutes <= 0) return { minutes: 0, amount: 0, capped: false, cappedAt: null };

  let raw = 0;

  if (method === "per_minute") {
    raw = minutes * Number(amount || 0);
  } else if (method === "salary_based") {
    const daily = Number(basicSalary || 0) / Number(dailySalaryDivisor || 30);
    // Pro-rata by the fraction of the shift that was missed.
    raw = (daily * minutes) / (Number(plannedShiftMinutes) || 480);
  } else if (method === "fixed") {
    raw = Number(amount || 0);
  } else {
    // Never guess with someone's pay: an unrecognised method charges nothing
    // rather than silently falling back to a flat fee.
    raw = 0;
  }

  raw = Math.max(0, Math.round(raw));

  const cap = Number(maxDeduction);
  if (Number.isFinite(cap) && cap > 0 && raw > cap) {
    return { minutes, amount: cap, capped: true, cappedAt: cap };
  }
  return { minutes, amount: raw, capped: false, cappedAt: null };
}

/**
 * Roll several occurrences up into a period total, capped once at the policy
 * maximum and counting warnings from the configured threshold.
 *
 * @param {Array<{lateMinutes:number}>} occurrences
 */
export function summariseDeductions(occurrences = [], policy = {}) {
  const params = policy.params || policy;
  const method = params.method || "fixed";
  const graceMinutes = Number(params.grace_minutes ?? DEFAULTS.graceMinutes);
  const maxDeduction = params.max_deduction ?? DEFAULTS.maxDeduction;
  const warnAfter = Number(params.warn_after ?? DEFAULTS.warnAfter);
  const basicSalary = Number(params.basic_salary || 0);
  const plannedShiftMinutes = Number(params.planned_shift_minutes || 480);

  const rows = occurrences.map((o) =>
    computeDeduction({
      lateMinutes: o.lateMinutes ?? o.late_minutes ?? 0,
      method,
      amount: params.amount,
      basicSalary,
      graceMinutes,
      maxDeduction,
      plannedShiftMinutes,
    })
  );

  const totalRaw = rows.reduce((sum, r) => sum + r.amount, 0);
  const cap = Number(maxDeduction);
  const totalCapped =
    Number.isFinite(cap) && cap > 0 ? Math.min(totalRaw, cap) : totalRaw;

  return {
    occurrences: rows,
    count: rows.filter((r) => r.minutes > 0).length,
    total_raw: totalRaw,
    total: totalCapped,
    capped: totalCapped < totalRaw,
    capped_at: totalCapped < totalRaw ? totalCapped : null,
    should_warn: rows.filter((r) => r.minutes > 0).length >= warnAfter,
    warn_after: warnAfter,
  };
}

/** Human label for the policy's conditional amount field. */
export const METHOD_LABEL = {
  fixed: "Fixed Amount",
  per_minute: "Per Minute",
  salary_based: "Salary Based",
};

export const METHOD_HELPER = {
  fixed: "Fixed deduction amount per occurrence",
  per_minute: "Rate charged for every minute past the grace period",
  salary_based: "Pro-rata of the daily salary for the time missed",
};

export const METHOD_PLACEHOLDER = {
  fixed: "e.g., 500",
  per_minute: "e.g., 10",
  salary_based: null,
};