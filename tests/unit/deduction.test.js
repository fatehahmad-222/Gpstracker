import { describe, it, expect } from "vitest";
import {
  DEFAULTS,
  DEDUCTION_METHODS,
  METHOD_LABEL,
  METHOD_HELPER,
  METHOD_PLACEHOLDER,
  chargeableMinutes,
  computeDeduction,
  summariseDeductions,
} from "@/lib/monitor/deduction";

describe("chargeableMinutes", () => {
  it("charges nothing inside the grace window", () => {
    expect(chargeableMinutes(10, 15)).toBe(0);
  });

  it("charges nothing exactly on the grace boundary", () => {
    expect(chargeableMinutes(15, 15)).toBe(0);
  });

  it("charges the minutes beyond grace", () => {
    expect(chargeableMinutes(25, 15)).toBe(10);
  });

  it("never returns a negative charge", () => {
    expect(chargeableMinutes(-30, 15)).toBe(0);
  });

  it("uses the default grace window", () => {
    expect(chargeableMinutes(DEFAULTS.graceMinutes)).toBe(0);
  });
});

describe("computeDeduction", () => {
  it("charges nothing for a fixed policy with no amount", () => {
    expect(computeDeduction({ lateMinutes: 30, method: "fixed", amount: 0 }).amount).toBe(0);
  });

  it("charges a flat fixed amount once past grace", () => {
    const d = computeDeduction({ lateMinutes: 30, method: "fixed", amount: 100 });
    expect(d.minutes).toBe(15);
    expect(d.amount).toBe(100);
  });

  it("charges per minute beyond grace", () => {
    const d = computeDeduction({ lateMinutes: 25, method: "per_minute", amount: 10, graceMinutes: 15 });
    expect(d.amount).toBe(10 * 10);
  });

  it("derives a salary-based charge pro-rata to the missed shift", () => {
    // daily = 30000 / 30 = 1000; 15 chargeable minutes of a 480-minute shift.
    const d = computeDeduction({ lateMinutes: 30, method: "salary_based", basicSalary: 30000 });
    expect(d.minutes).toBe(15);
    expect(d.amount).toBe(Math.round((1000 * 15) / 480));
  });

  it("honours a custom daily divisor", () => {
    const d = computeDeduction({
      lateMinutes: 30,
      method: "salary_based",
      basicSalary: 30000,
      dailySalaryDivisor: 22,
    });
    expect(d.amount).toBe(Math.round((30000 / 22 * 15) / 480));
  });

  it("is zero when the employee is on time", () => {
    expect(computeDeduction({ lateMinutes: 0, method: "per_minute", amount: 10 }).amount).toBe(0);
  });

  it("charges nothing for a zero salary on a salary-based policy", () => {
    expect(computeDeduction({ lateMinutes: 30, method: "salary_based", basicSalary: 0 }).amount).toBe(0);
  });

  it("treats an unknown method as a flat zero rather than charging", () => {
    const d = computeDeduction({ lateMinutes: 30, method: "psychic", amount: 500 });
    expect(d.amount).toBe(0);
  });

  it("honours a maximum deduction cap", () => {
    const d = computeDeduction({
      lateMinutes: 300,
      method: "per_minute",
      amount: 10,
      maxDeduction: 500,
    });
    expect(d.amount).toBe(500);
    expect(d.capped).toBe(true);
    expect(d.cappedAt).toBe(500);
  });

  it("reports uncapped when under the limit", () => {
    const d = computeDeduction({ lateMinutes: 30, method: "per_minute", amount: 10, maxDeduction: 5000 });
    expect(d.capped).toBe(false);
    expect(d.cappedAt).toBeNull();
  });

  it("treats a zero cap as uncapped", () => {
    const d = computeDeduction({ lateMinutes: 60, method: "per_minute", amount: 10, maxDeduction: 0 });
    expect(d.capped).toBe(false);
  });

  it("tolerates being called with no arguments", () => {
    expect(computeDeduction().amount).toBe(0);
  });

  it("rounds to whole rupees", () => {
    const d = computeDeduction({ lateMinutes: 17, method: "per_minute", amount: 3.5, graceMinutes: 15 });
    expect(Number.isInteger(d.amount)).toBe(true);
  });
});

describe("summariseDeductions", () => {
  const policy = { method: "fixed", amount: 100 };

  it("is zero for no occurrences", () => {
    expect(summariseDeductions([], policy).total).toBe(0);
  });

  it("totals a payroll's worth of occurrences", () => {
    const rows = [{ lateMinutes: 30 }, { lateMinutes: 45 }];
    expect(summariseDeductions(rows, policy).total).toBe(200);
  });

  it("counts only the days that were actually chargeable", () => {
    const s = summariseDeductions([{ lateMinutes: 30 }, { lateMinutes: 0 }], policy);
    expect(s.total).toBe(100);
    expect(s.count).toBe(1);
  });

  it("reads snake_case rows from the database too", () => {
    expect(summariseDeductions([{ late_minutes: 30 }], policy).total).toBe(100);
  });

  it("accepts the policy nested under params", () => {
    expect(summariseDeductions([{ lateMinutes: 30 }], { params: policy }).total).toBe(100);
  });

  it("caps the period total once", () => {
    const rows = Array.from({ length: 20 }, () => ({ lateMinutes: 30 }));
    const s = summariseDeductions(rows, { ...policy, max_deduction: 500 });
    expect(s.total).toBe(500);
    expect(s.total_raw).toBe(2000);
    expect(s.capped).toBe(true);
  });

  it("raises a warning once the threshold is reached", () => {
    const rows = Array.from({ length: 6 }, () => ({ lateMinutes: 30 }));
    expect(summariseDeductions(rows, { ...policy, warn_after: 5 }).should_warn).toBe(true);
    expect(summariseDeductions(rows, { ...policy, warn_after: 50 }).should_warn).toBe(false);
  });

  it("keeps the raw total alongside the capped one", () => {
    const s = summariseDeductions([{ lateMinutes: 30 }], policy);
    expect(s.total_raw).toBe(s.total);
  });
});

describe("method metadata", () => {
  it("labels, explains and placeholders every method", () => {
    for (const m of DEDUCTION_METHODS) {
      expect(METHOD_LABEL[m]).toBeTruthy();
      expect(METHOD_HELPER[m]).toBeTruthy();
      expect(Object.keys(METHOD_PLACEHOLDER)).toContain(m);
    }
  });
});