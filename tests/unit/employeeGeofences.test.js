import { describe, expect, it } from "vitest";

import { syncGeofences } from "@/lib/server/employees";

/**
 * PostgREST treats the JS value `null` in `.neq("employee_id", null)` as the
 * literal string "null", which fails a uuid comparison with a 400. That made
 * employee creation report "Could not save this employee" after the row had
 * already been inserted, so the delete must rely on the eq filters only.
 */
function fakeSupabase({ deleteError = null, insertError = null } = {}) {
  const state = {
    table: null,
    op: null,
    deleteFilters: [],
    neqCalled: false,
    inserted: null,
  };

  const chain = {
    from(table) {
      state.table = table;
      return chain;
    },
    delete() {
      state.op = "delete";
      return chain;
    },
    eq(column, value) {
      state.deleteFilters.push([column, value]);
      return chain;
    },
    neq() {
      state.neqCalled = true;
      return chain;
    },
    insert(rows) {
      state.inserted = rows;
      return Promise.resolve({ error: insertError });
    },
    then(resolve, reject) {
      return Promise.resolve({ error: deleteError }).then(resolve, reject);
    },
  };

  return { supabase: chain, state };
}

describe("syncGeofences", () => {
  it("clears assignments with eq filters and never sends neq null", async () => {
    const { supabase, state } = fakeSupabase();

    const linked = await syncGeofences(supabase, {
      companyId: "company-1",
      employeeId: "employee-1",
      geofenceIds: [],
    });

    expect(linked).toBe(0);
    expect(state.table).toBe("employee_geofences");
    expect(state.op).toBe("delete");
    expect(state.deleteFilters).toEqual([
      ["employee_id", "employee-1"],
      ["company_id", "company-1"],
    ]);
    expect(state.neqCalled).toBe(false);
    expect(state.inserted).toBeNull();
  });

  it("inserts one row per unique geofence", async () => {
    const { supabase, state } = fakeSupabase();

    const linked = await syncGeofences(supabase, {
      companyId: "company-1",
      employeeId: "employee-1",
      geofenceIds: ["fence-1", "fence-2", "fence-1"],
    });

    expect(linked).toBe(2);
    expect(state.inserted).toEqual([
      { company_id: "company-1", employee_id: "employee-1", geofence_id: "fence-1" },
      { company_id: "company-1", employee_id: "employee-1", geofence_id: "fence-2" },
    ]);
  });

  it("surfaces a failed clear instead of inserting", async () => {
    const { supabase, state } = fakeSupabase({ deleteError: new Error("clear failed") });

    await expect(
      syncGeofences(supabase, {
        companyId: "company-1",
        employeeId: "employee-1",
        geofenceIds: ["fence-1"],
      })
    ).rejects.toThrow("clear failed");

    expect(state.inserted).toBeNull();
  });
});
