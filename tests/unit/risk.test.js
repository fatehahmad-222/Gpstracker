import { describe, it, expect } from "vitest";
import {
  DEFAULT_RISK_WEIGHTS,
  RISK_BANDS,
  riskBand,
  resolveWeights,
  computeRisk,
  riskReasons,
  isFlagged,
} from "@/lib/monitor/risk";

describe("computeRisk", () => {
  it("scores zero with no signals", () => {
    expect(computeRisk({}).score).toBe(0);
  });

  it("returns no contributions for a clean employee", () => {
    expect(computeRisk({}).contributions).toEqual([]);
  });

  it("ignores negative counts", () => {
    expect(computeRisk({ force_stop: -5 }).score).toBe(0);
  });

  it("applies the documented weight", () => {
    expect(computeRisk({ force_stop: 1 }).score).toBe(DEFAULT_RISK_WEIGHTS.force_stop);
    expect(computeRisk({ fake_gps: 1 }).score).toBe(DEFAULT_RISK_WEIGHTS.fake_gps);
  });

  it("multiplies weight by count", () => {
    expect(computeRisk({ force_stop: 3 }).score).toBe(DEFAULT_RISK_WEIGHTS.force_stop * 3);
  });

  it("grows as more signals accumulate", () => {
    const few = computeRisk({ force_stop: 1 }).score;
    const many = computeRisk({ force_stop: 1, out_of_zone: 3, heartbeat_gap: 2 }).score;
    expect(many).toBeGreaterThan(few);
  });

  it("drops trailing zeroes from the score", () => {
    // 1.5 x 2 = 3.0 -> 3, not 3.0
    expect(computeRisk({ auto_clock_out: 2 }).score).toBe(3);
  });

  it("scores derived signals that have no event column", () => {
    // Regression guard: auto_clock_out is a weight with no SIGNAL_KEYS entry,
    // so keying off SIGNAL_KEYS used to silently ignore it.
    expect(computeRisk({ auto_clock_out: 1 }).score).toBe(DEFAULT_RISK_WEIGHTS.auto_clock_out);
    expect(computeRisk({ no_clock_in: 1 }).score).toBe(DEFAULT_RISK_WEIGHTS.no_clock_in);
  });

  it("ignores signals with no weight", () => {
    expect(computeRisk({ no_sync_24h: 5 }).score).toBe(0);
  });

  it("orders contributions heaviest first", () => {
    // fake_gps (10 x 1 = 10) outweighs battery_low (1 x 5 = 5).
    const { contributions } = computeRisk({ battery_low: 5, fake_gps: 1 });
    expect(contributions[0].key).toBe("fake_gps");
    expect(contributions[1].key).toBe("battery_low");
  });

  it("reproduces the calibration example in the module docs", () => {
    // 2 auto clock-outs (1.5 x 2 = 3) + 1 force stop (4) = 7
    expect(computeRisk({ auto_clock_out: 2, force_stop: 1 }).score).toBe(7);
  });
});

describe("riskBand", () => {
  it("maps a zero score to the clean band", () => {
    expect(riskBand(0).key).toBe("none");
  });

  it("escalates as the score rises", () => {
    expect(riskBand(2).key).toBe("low");
    expect(riskBand(7).key).toBe("medium");
    expect(riskBand(50).key).toBe("high");
  });

  it("keeps escalating above every intermediate band", () => {
    // The medium band is inclusive of 9, so 10 is the first "high" score.
    expect(riskBand(9).key).toBe("medium");
    expect(riskBand(10).key).toBe("high");
    expect(riskBand(1000).key).toBe("high");
  });

  it("gives every band a label and class for the pill", () => {
    for (const band of RISK_BANDS) {
      expect(band.label).toBeTruthy();
      expect(band.className).toBeTruthy();
    }
  });
});

describe("resolveWeights", () => {
  it("returns the defaults with no company settings", () => {
    expect(resolveWeights()).toEqual(DEFAULT_RISK_WEIGHTS);
  });

  it("returns the defaults when risk_weights is absent", () => {
    expect(resolveWeights({ something_else: true })).toEqual(DEFAULT_RISK_WEIGHTS);
  });

  it("does not mutate the defaults", () => {
    resolveWeights({ risk_weights: { force_stop: 99 } });
    expect(DEFAULT_RISK_WEIGHTS.force_stop).toBe(4);
  });

  it("overrides a single weight and keeps the rest", () => {
    const resolved = resolveWeights({ risk_weights: { force_stop: 20 } });
    expect(resolved.force_stop).toBe(20);
    expect(resolved.fake_gps).toBe(DEFAULT_RISK_WEIGHTS.fake_gps);
  });

  it("ignores non-numeric overrides", () => {
    expect(resolveWeights({ risk_weights: { force_stop: "abc" } }).force_stop).toBe(4);
  });

  it("ignores negative overrides", () => {
    expect(resolveWeights({ risk_weights: { force_stop: -5 } }).force_stop).toBe(4);
  });

  it("accepts a numeric string override", () => {
    expect(resolveWeights({ risk_weights: { force_stop: "20" } }).force_stop).toBe(20);
  });
});

describe("riskReasons", () => {
  it("returns nothing for a clean employee", () => {
    expect(riskReasons({})).toEqual([]);
  });

  it("lists the issues heaviest first", () => {
    const reasons = riskReasons({ battery_low: 5, fake_gps: 1 });
    expect(reasons[0].key).toBe("fake_gps");
    expect(reasons[1].count).toBe(5);
  });

  it("honours the limit", () => {
    expect(riskReasons({ force_stop: 1, out_of_zone: 1, fake_gps: 1, location_off: 1 }, undefined, 2))
      .toHaveLength(2);
  });

  it("defaults to three reasons", () => {
    const reasons = riskReasons({ force_stop: 1, out_of_zone: 1, fake_gps: 1, location_off: 1 });
    expect(reasons).toHaveLength(3);
  });
});

describe("isFlagged", () => {
  it("does not flag a clean employee", () => {
    expect(isFlagged({})).toBe(false);
  });

  it("flags an employee with any signal", () => {
    expect(isFlagged({ force_stop: 1 })).toBe(true);
  });

  it("does not flag zero-valued signals", () => {
    expect(isFlagged({ force_stop: 0 })).toBe(false);
  });
});