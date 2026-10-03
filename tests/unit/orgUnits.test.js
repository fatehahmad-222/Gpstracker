import { describe, it, expect } from "vitest";

import {
  ORG_UNITS,
  createSchemaFor,
  patchSchemaFor,
  listOrgUnits,
  createOrgUnit,
  updateOrgUnit,
  deleteOrgUnit,
  listEmployeesForPicker,
  describeOrgUnit,
} from "@/lib/server/orgUnits";

const COMPANY = "11111111-1111-4111-8111-111111111111";

/**
 * Minimal stand-in for the supabase-js query builder.
 *
 * The server modules are thin wrappers over `.from().select()...`, so the tests
 * assert on the chain they build (filters applied, table touched, columns
 * selected) rather than on a real database.
 */
function fakeSupabase(responses = {}) {
  const calls = [];

  function make(table) {
    const state = { table, filters: [], columns: null, order: null, upsert: null };

    const settle = () => {
      calls.push(state);
      const value = typeof responses[table] === "function" ? responses[table](state) : responses[table];
      return Promise.resolve(value ?? { data: null, error: null });
    };

    const builder = {
      select(columns) {
        state.columns = columns;
        return builder;
      },
      upsert(row, options) {
        state.upsert = { row, options };
        return builder;
      },
      insert(row) {
        state.upsert = { row, options: null };
        return builder;
      },
      update(values) {
        state.values = values;
        return builder;
      },
      delete() {
        state.deleted = true;
        return builder;
      },
      eq(column, value) {
        state.filters.push([column, value]);
        return builder;
      },
      in() {
        return builder;
      },
      or(filter) {
        state.orFilter = filter;
        return builder;
      },
      order() {
        state.order = true;
        return builder;
      },
      limit() {
        return builder;
      },
      range() {
        return builder;
      },
      single() {
        return settle();
      },
      maybeSingle() {
        return settle();
      },
      then(resolve) {
        return settle().then(resolve);
      },
    };
    return builder;
  }

  return { from: (table) => make(table), calls };
}

describe("org unit specs", () => {
  it("covers the three configuration tables from spec 4.3", () => {
    expect(Object.keys(ORG_UNITS)).toEqual([
      "departments",
      "sub_departments",
      "designations",
    ]);
  });

  it("gives every table a tenant-scoped conflict target", () => {
    for (const spec of Object.values(ORG_UNITS)) {
      expect(spec.conflictColumns).toContain("company_id");
    }
  });

  it("describes a row for the audit log", () => {
    expect(describeOrgUnit("departments", { name: "Sales" })).toBe('Department "Sales"');
    expect(describeOrgUnit("sub_departments", { name: "North" })).toBe('Sub-Department "North"');
    expect(describeOrgUnit("designations", { name: "Driver" })).toBe('Designation "Driver"');
  });

  it("refuses to describe an unknown kind", () => {
    expect(() => describeOrgUnit("payroll", { name: "X" })).toThrow();
  });
});

describe("createSchemaFor", () => {
  it("requires a name for every kind", () => {
    const deptId = "22222222-2222-4222-8222-222222222222";

    for (const kind of Object.keys(ORG_UNITS)) {
      const schema = createSchemaFor(kind);
      expect(schema.safeParse({}).success).toBe(false);

      // Child tables also need their parent department.
      const values = { name: "Sales" };
      if (ORG_UNITS[kind].hasDepartment) values.department_id = deptId;
      expect(schema.safeParse(values).success).toBe(true);
    }
  });

  it("rejects a one character name", () => {
    expect(createSchemaFor("departments").safeParse({ name: "S" }).success).toBe(false);
  });

  it("only requires a department for the child tables", () => {
    expect(createSchemaFor("departments").safeParse({ name: "Sales" }).success).toBe(true);
    expect(createSchemaFor("sub_departments").safeParse({ name: "North" }).success).toBe(false);
    expect(createSchemaFor("designations").safeParse({ name: "Driver" }).success).toBe(false);
  });

  it("validates the parent department as a uuid", () => {
    const id = "22222222-2222-4222-8222-222222222222";
    expect(
      createSchemaFor("sub_departments").safeParse({ name: "North", department_id: id }).success
    ).toBe(true);
    expect(
      createSchemaFor("sub_departments").safeParse({ name: "North", department_id: "nope" }).success
    ).toBe(false);
  });

  it("defaults to active and normalises an empty code to null", () => {
    const result = createSchemaFor("departments").parse({ name: "Sales", code: "" });
    expect(result.status).toBe("active");
    expect(result.code).toBeNull();
  });

  it("rejects an unknown status", () => {
    expect(
      createSchemaFor("departments").safeParse({ name: "Sales", status: "deleted" }).success
    ).toBe(false);
  });

  it("throws for an unknown kind", () => {
    expect(() => createSchemaFor("payroll")).toThrow(/Unknown org unit/);
  });
});

describe("patchSchemaFor", () => {
  it("accepts a partial body", () => {
    expect(patchSchemaFor("departments").safeParse({ name: "Sales Ops" }).success).toBe(true);
  });

  it("rejects an empty body rather than silently no-opping", () => {
    expect(patchSchemaFor("departments").safeParse({}).success).toBe(false);
  });

  it("does not re-apply the create-time status default", () => {
    const parsed = patchSchemaFor("departments").parse({ name: "Sales Ops" });
    expect(parsed.status).toBeUndefined();
  });

  it("still validates the parent when supplied", () => {
    expect(patchSchemaFor("sub_departments").safeParse({ department_id: "nope" }).success).toBe(
      false
    );
  });
});

describe("listOrgUnits", () => {
  it("scopes the query to the company and to active rows", async () => {
    const supabase = fakeSupabase({ departments: { data: [] } });

    await listOrgUnits(supabase, { kind: "departments", companyId: COMPANY });

    const list = supabase.calls.find((c) => c.table === "departments");
    expect(list.filters).toContainEqual(["company_id", COMPANY]);
    expect(list.filters).toContainEqual(["status", "active"]);
  });

  it("includes archived rows on request", async () => {
    const supabase = fakeSupabase({ departments: { data: [] } });

    await listOrgUnits(supabase, { kind: "departments", companyId: COMPANY, includeInactive: true });

    const list = supabase.calls.find((c) => c.table === "departments");
    expect(list.filters.some(([col]) => col === "status")).toBe(false);
  });

  it("filters children by department", async () => {
    const supabase = fakeSupabase({ sub_departments: { data: [] } });
    const deptId = "33333333-3333-4333-8333-333333333333";

    await listOrgUnits(supabase, {
      kind: "sub_departments",
      companyId: COMPANY,
      departmentId: deptId,
    });

    const list = supabase.calls.find((c) => c.table === "sub_departments");
    expect(list.filters).toContainEqual(["department_id", deptId]);
  });

  it("counts active employees per department", async () => {
    const supabase = fakeSupabase({
      departments: { data: [{ id: "d1", name: "Sales" }, { id: "d2", name: "Support" }] },
      employees: {
        data: [
          { id: "e1", department_id: "d1", sub_department_id: null, designation_id: "g1" },
          { id: "e2", department_id: "d1", sub_department_id: "s1", designation_id: "g1" },
          { id: "e3", department_id: "d2", sub_department_id: null, designation_id: "g2" },
        ],
      },
    });

    const rows = await listOrgUnits(supabase, { kind: "departments", companyId: COMPANY });

    expect(rows.map((r) => r.employee_count)).toEqual([2, 1]);
  });

  it("selects designation_id so designation headcounts are not always zero", async () => {
    const supabase = fakeSupabase({
      designations: { data: [{ id: "g1", name: "Driver" }] },
      employees: {
        data: [
          { id: "e1", department_id: "d1", sub_department_id: null, designation_id: "g1" },
          { id: "e2", department_id: "d1", sub_department_id: null, designation_id: "g2" },
        ],
      },
    });

    const [row] = await listOrgUnits(supabase, { kind: "designations", companyId: COMPANY });

    const employeeQuery = supabase.calls.find((c) => c.table === "employees");
    expect(employeeQuery.columns).toContain("designation_id");
    expect(row.employee_count).toBe(1);
  });

  it("counts sub-departments by sub_department_id", async () => {
    const supabase = fakeSupabase({
      sub_departments: { data: [{ id: "s1", name: "North" }] },
      employees: {
        data: [
          { id: "e1", department_id: "d1", sub_department_id: "s1", designation_id: "g1" },
        ],
      },
    });

    const [row] = await listOrgUnits(supabase, { kind: "sub_departments", companyId: COMPANY });
    expect(row.employee_count).toBe(1);
  });

  it("reports zero rather than throwing when the employee lookup fails", async () => {
    const supabase = fakeSupabase({
      departments: { data: [{ id: "d1", name: "Sales" }] },
      employees: { data: null, error: { message: "denied" } },
    });

    const [row] = await listOrgUnits(supabase, { kind: "departments", companyId: COMPANY });
    expect(row.employee_count).toBe(0);
  });
});

describe("createOrgUnit", () => {
  it("stamps the company and upserts on the tenant-scoped conflict", async () => {
    const supabase = fakeSupabase({ departments: { data: { id: "d1" }, error: null } });

    await createOrgUnit(supabase, {
      kind: "departments",
      companyId: COMPANY,
      values: { name: "Sales", code: null, status: "active" },
    });

    const call = supabase.calls[0];
    expect(call.table).toBe("departments");
    expect(call.upsert.row.company_id).toBe(COMPANY);
    expect(call.upsert.options.onConflict).toBe("company_id,name");
  });

  it("scopes a sub-department conflict to its parent department", async () => {
    const supabase = fakeSupabase({ sub_departments: { data: { id: "s1" }, error: null } });

    await createOrgUnit(supabase, {
      kind: "sub_departments",
      companyId: COMPANY,
      values: { name: "North", status: "active" },
    });

    expect(supabase.calls[0].upsert.options.onConflict).toBe("company_id,department_id,name");
  });
});

describe("updateOrgUnit", () => {
  it("filters by id and company so one tenant cannot edit another", async () => {
    const supabase = fakeSupabase({ departments: { data: { id: "d1" }, error: null } });

    await updateOrgUnit(supabase, {
      kind: "departments",
      companyId: COMPANY,
      id: "d1",
      values: { name: "Sales Ops" },
    });

    const call = supabase.calls[0];
    expect(call.filters).toContainEqual(["id", "d1"]);
    expect(call.filters).toContainEqual(["company_id", COMPANY]);
    expect(call.values).toEqual({ name: "Sales Ops" });
  });
});

describe("deleteOrgUnit", () => {
  it("archives instead of deleting when employees are still assigned", async () => {
    const supabase = fakeSupabase({
      employees: { count: 4, error: null },
      departments: { data: { id: "d1", status: "inactive" }, error: null },
    });

    const result = await deleteOrgUnit(supabase, {
      kind: "departments",
      companyId: COMPANY,
      id: "d1",
    });

    expect(result).toMatchObject({ deleted: false, archived: true, employeeCount: 4 });
    const update = supabase.calls.find((c) => c.values);
    expect(update.values).toEqual({ status: "inactive" });
    expect(supabase.calls.some((c) => c.deleted)).toBe(false);
  });

  it("deletes when nothing references it", async () => {
    const supabase = fakeSupabase({
      employees: { count: 0, error: null },
      departments: { data: null, error: null },
    });

    const result = await deleteOrgUnit(supabase, {
      kind: "departments",
      companyId: COMPANY,
      id: "d1",
    });

    expect(result).toMatchObject({ deleted: true, archived: false, employeeCount: 0 });
    expect(supabase.calls.some((c) => c.deleted && c.table === "departments")).toBe(true);
  });

  it("checks the right parent column per kind", async () => {
    for (const [kind, column] of [
      ["departments", "department_id"],
      ["sub_departments", "sub_department_id"],
      ["designations", "designation_id"],
    ]) {
      const supabase = fakeSupabase({
        employees: { count: 0, error: null },
        [kind]: { data: null, error: null },
      });

      await deleteOrgUnit(supabase, { kind, companyId: COMPANY, id: "x1" });

      const employeeCall = supabase.calls.find((c) => c.table === "employees");
      expect(employeeCall.filters).toContainEqual([column, "x1"]);
    }
  });

  it("propagates a delete error instead of reporting success", async () => {
    const supabase = fakeSupabase({
      employees: { count: 0, error: null },
      departments: { data: null, error: { message: "constraint violation" } },
    });

    await expect(
      deleteOrgUnit(supabase, { kind: "departments", companyId: COMPANY, id: "d1" })
    ).rejects.toThrow(/constraint violation/);
  });
});

describe("listEmployeesForPicker", () => {
  it("returns only active employees for the company", async () => {
    const supabase = fakeSupabase({ employees: { data: [{ id: "e1", name: "Ali" }] } });

    const rows = await listEmployeesForPicker(supabase, { companyId: COMPANY });

    expect(rows).toHaveLength(1);
    const call = supabase.calls[0];
    expect(call.filters).toContainEqual(["company_id", COMPANY]);
    expect(call.filters).toContainEqual(["status", "active"]);
  });

  it("strips filter syntax from a search term", async () => {
    const supabase = fakeSupabase({ employees: { data: [] } });

    await listEmployeesForPicker(supabase, {
      companyId: COMPANY,
      search: 'ali",name.eq.bob),(x),%',
    });

    const applied = supabase.calls[0].orFilter;
    expect(applied).toContain("name.ilike");
    expect(applied).toContain("code.ilike");

    // Exactly four quotes remain: the two delimiter pairs, so nothing from the
    // search term can terminate the quoted literal or start a new filter. The
    // remaining text survives only as an inert literal.
    expect(applied.match(/"/g)).toHaveLength(4);

    const start = applied.indexOf('"') + 1;
    const term = applied.slice(start, applied.indexOf('"', start));
    expect(term).not.toMatch(/["\\%,()]/);
  });
});