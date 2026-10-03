import { describe, it, expect } from "vitest";

import {
  POLICY_TYPES,
  PARAMS_BY_TYPE,
  isPolicyType,
  toPolicyRow,
  withScopeLabels,
} from "@/lib/server/policies";
import { computeDeduction, summariseDeductions } from "@/lib/monitor/deduction";
import { policySchemaFor } from "@/lib/monitor/validation";

function fakeSupabase(responses = {}) {
  const calls = [];

  function make(table) {
    const state = { table, filters: [] };
    const builder = {
      select: () => builder,
      in: () => builder,
      eq: (column, value) => {
        state.filters.push([column, value]);
        return builder;
      },
      then(resolve) {
        calls.push(state);
        return Promise.resolve(responses[table] ?? { data: [] }).then(resolve);
      },
    };
    return builder;
  }

  return { from: (table) => make(table), calls };
}

const COMPANY = "11111111-1111-4111-8111-111111111111";
const DEPT = { id: "d1", name: "Sales" };
const STAFF = { id: "e1", name: "Ali Raza" };

/** withScopeLabels needs a client and an explicit company id. */
const label = (supabase, rows) => withScopeLabels(supabase, rows, COMPANY);

describe("policy metadata", () => {
  it("offers the two forms from spec 4.4", () => {
    expect(POLICY_TYPES.map((t) => t.value)).toEqual(["late_early_deduction", "presence_check"]);
  });

  it("only recognises the two supported types", () => {
    expect(isPolicyType("late_early_deduction")).toBe(true);
    expect(isPolicyType("presence_check")).toBe(true);
    expect(isPolicyType("salary_slip")).toBe(false);
    expect(isPolicyType(null)).toBe(false);
  });

  it("declares params for both types", () => {
    expect(PARAMS_BY_TYPE.late_early_deduction).toContain("amount");
    expect(PARAMS_BY_TYPE.late_early_deduction).toContain("method");
    expect(PARAMS_BY_TYPE.presence_check).toContain("selfie_grace_minutes");
  });
});

describe("toPolicyRow", () => {
  it("splits real columns from jsonb params", () => {
    const { columnRow, params } = toPolicyRow(
      {
        name: "Standard grace",
        description: "15 minutes",
        effective_from: "2026-01-01",
        grace_minutes: 15,
        method: "fixed",
        amount: 500,
        max_deduction: 2000,
        warn_after: 5,
      },
      "late_early_deduction"
    );

    expect(columnRow).toMatchObject({
      name: "Standard grace",
      description: "15 minutes",
      effective_from: "2026-01-01",
    });
    expect(columnRow.grace_minutes).toBeUndefined();
    expect(params).toEqual({
      grace_minutes: 15,
      method: "fixed",
      amount: 500,
      max_deduction: 2000,
      warn_after: 5,
    });
  });

  it("routes presence settings into params too", () => {
    const { columnRow, params } = toPolicyRow(
      { name: "Selfie check", selfie_grace_minutes: 10, notifications: 2 },
      "presence_check"
    );

    expect(params).toEqual({ selfie_grace_minutes: 10, notifications: 2 });
    expect(columnRow.selfie_grace_minutes).toBeUndefined();
  });

  it("stores an unset scope reference as null, not an empty string", () => {
    const { columnRow } = toPolicyRow(
      { name: "Company wide", scope: "all", scope_ref_id: "" },
      "late_early_deduction"
    );

    // An empty string is not a valid uuid and would fail the column type.
    expect(columnRow.scope_ref_id).toBeNull();
  });

  it("keeps a real scope reference", () => {
    const { columnRow } = toPolicyRow(
      { name: "Sales only", scope: "department", scope_ref_id: "d1" },
      "late_early_deduction"
    );

    expect(columnRow.scope_ref_id).toBe("d1");
  });

  it("defaults status to active", () => {
    const { columnRow } = toPolicyRow({ name: "New policy" }, "presence_check");
    expect(columnRow.status).toBe("active");
  });
});

describe("withScopeLabels", () => {
  const base = { scope_ref_id: null, params: {}, type: "presence_check" };

  it("labels a company-wide policy", async () => {
    const rows = await label(fakeSupabase(), [
      { ...base, scope: "all", name: "All hands" },
    ]);

    expect(rows[0].scope_label).toBe("All employees");
  });

  it("resolves a department name", async () => {
    const supabase = fakeSupabase({ departments: { data: [DEPT] } });

    const rows = await withScopeLabels(supabase, [
      { ...base, scope: "department", scope_ref_id: "d1" },
    ], COMPANY);

    expect(rows[0].scope_label).toBe("Sales");
  });

  it("falls back when a referenced row has gone", async () => {
    const rows = await label(fakeSupabase({ departments: { data: [] } }), [
      { ...base, scope: "department", scope_ref_id: "missing" },
    ]);

    expect(rows[0].scope_label).toBe("Unknown department");
  });

  it("resolves an employee scope", async () => {
    const supabase = fakeSupabase({ employees: { data: [STAFF] } });

    const rows = await withScopeLabels(supabase, [
      { ...base, scope: "employee", scope_ref_id: "e1" },
    ], COMPANY);

    expect(rows[0].scope_label).toBe("Ali Raza");
  });

  it("previews a 30 minute late charge for a fixed-amount policy", async () => {
    const rows = await label(fakeSupabase(), [
      {
        ...base,
        type: "late_early_deduction",
        scope: "all",
        params: { grace_minutes: 15, method: "fixed", amount: 500 },
      },
    ]);

    expect(rows[0].deduction_preview).toBe(500);
  });

  it("accounts for the grace period in the preview", async () => {
    const params = { grace_minutes: 30, method: "per_minute", amount: 10 };

    // 30 minutes late is entirely inside a 30 minute grace period.
    const rows = await label(fakeSupabase(), [
      { ...base, type: "late_early_deduction", scope: "all", params },
    ]);

    expect(rows[0].deduction_preview).toBe(0);
  });

  it("reports no preview for a salary-based policy", async () => {
    const rows = await label(fakeSupabase(), [
      {
        ...base,
        type: "late_early_deduction",
        scope: "all",
        params: { grace_minutes: 15, method: "salary_based" },
      },
    ]);

    // The charge depends on the individual employee's salary, so a single
    // company-wide figure would be wrong.
    expect(rows[0].deduction_preview).toBeNull();
  });

  it("reports no preview for a presence check", async () => {
    const rows = await label(fakeSupabase(), [
      { ...base, scope: "all", params: { selfie_grace_minutes: 10 } },
    ]);

    expect(rows[0].deduction_preview).toBeNull();
  });

  it("matches the deduction engine's own total", async () => {
    const params = { grace_minutes: 10, method: "per_minute", amount: 15, max_deduction: 300 };
    const rows = await label(fakeSupabase(), [
      { ...base, type: "late_early_deduction", scope: "all", params },
    ]);

    const expected = summariseDeductions([{ lateMinutes: 30 }], { params }).total;
    expect(rows[0].deduction_preview).toBe(expected);
    expect(expected).toBe(300); // 20 chargeable minutes * 15 = 300, at the cap
  });
});

describe("policy round trip", () => {
  it("stores only fields the schema accepts for that type", () => {
    const parsed = policySchemaFor("late_early_deduction").parse({
      name: "Standard grace",
      effective_from: "2026-01-01",
      scope: "all",
      grace_minutes: 15,
      method: "fixed",
      amount: 500,
      max_deduction: 2000,
      warn_after: 5,
    });

    const { columnRow, params } = toPolicyRow(parsed, "late_early_deduction");
    const merged = { ...columnRow, ...params };

    expect(merged.name).toBe("Standard grace");
    expect(merged.description).toBe("");
    expect(merged.status).toBe("active");
    expect(merged.amount).toBe(500);
    expect(merged.method).toBe("fixed");
    expect(computeDeduction({ lateMinutes: 45, ...params }).amount).toBe(500);
  });

  it("allows an employee scope for a deduction policy", () => {
    const parsed = policySchemaFor("late_early_deduction").parse({
      name: "Contractor",
      effective_from: "2026-01-01",
      scope: "employee",
      scope_ref_id: "44444444-4444-4444-8444-444444444444",
      grace_minutes: 0,
      method: "fixed",
      amount: 250,
      warn_after: 3,
    });

    expect(parsed.scope).toBe("employee");
  });

  it("ignores a presence field sent to the deduction schema", () => {
    const result = policySchemaFor("late_early_deduction").safeParse({
      name: "Standard grace",
      effective_from: "2026-01-01",
      scope: "all",
      grace_minutes: 15,
      method: "fixed",
      amount: 500,
      warn_after: 5,
      selfie_grace_minutes: 10,
    });

    expect(result.success).toBe(true);
    // Unknown keys are stripped, so a stray field can never reach the row.
    expect(result.data.selfie_grace_minutes).toBeUndefined();
    expect(
      toPolicyRow(result.data, "late_early_deduction").params.selfie_grace_minutes
    ).toBeUndefined();
  });
});