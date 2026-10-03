import { describe, it, expect } from "vitest";

import { ingestBatch, issueDeviceToken, revokeDeviceToken, authenticateDevice, hashToken } from "@/lib/server/ingest";

/**
 * A hand-rolled Supabase double.
 *
 * Deliberately not a general mock: it records the exact statements issued, because
 * the things worth protecting here are the *query shapes* - does the token decide
 * the employee, is the idempotency conflict target the columns that have a unique
 * index, is the device heartbeat written with service scope. Asserting on calls
 * catches a whole class of bug that a value-only fake would pass.
 */
function makeClient(overrides = {}) {
  const calls = [];
  /** Per-table results, so `employees` can resolve to an active employee while
   *  `device_tokens` resolves to nothing. */
  const single = overrides.single ?? {};
  const rows = overrides.rows ?? {};

  /** A chainable query builder that records every step and resolves empty. */
  function builder(table) {
    const chain = {
      _table: table,
      select: (...args) => {
        calls.push({ op: "select", table, args });
        return chain;
      },
      insert: (...args) => {
        calls.push({ op: "insert", table, args });
        return chain;
      },
      update: (...args) => {
        calls.push({ op: "update", table, args });
        return chain;
      },
      upsert: (...args) => {
        calls.push({ op: "upsert", table, args });
        return chain;
      },
      eq: (...args) => {
        calls.push({ op: "eq", table, args });
        return chain;
      },
      is: (...args) => {
        calls.push({ op: "is", table, args });
        return chain;
      },
      order: () => chain,
      limit: () => chain,
      maybeSingle: async () => ({ data: single[table] ?? null, error: null }),
      single: async () => ({ data: single[table] ?? null, error: null }),
      then: (resolve) => resolve({ data: rows[table] ?? [], error: null }),
    };
    return chain;
  }

  return {
    calls,
    rpc: async (fn, args) => {
      calls.push({ op: "rpc", fn, args });
      return overrides.rpcResult ?? { data: true, error: null };
    },
    from: (table) => builder(table),
    ...overrides.methods,
  };
}

const ACTIVE_EMPLOYEE = { id: "emp-1", status: "active", deleted_at: null, profile_id: "prof-1" };

const DEVICE = {
  id: "tok-1",
  company_id: "co-1",
  employee_id: "emp-1",
  device_id: "dev-1",
};

function callsOn(client, table) {
  return client.calls.filter((c) => c.table === table);
}

describe("ingestBatch identity", () => {
  it("takes the employee from the token, never from the body", async () => {
    const client = makeClient();
    await ingestBatch(client, {
      device: DEVICE,
      body: {
        events: [
          {
            type: "power_off",
            occurred_at: new Date().toISOString(),
            client_event_id: "a",
            employee_id: "attacker-emp",
          },
        ],
      },
    });

    const eventInsert = callsOn(client, "device_events")[0];
    expect(eventInsert.args[0][0].employee_id).toBe("emp-1");
    expect(eventInsert.args[0][0].company_id).toBe("co-1");
    // And the forged field is not smuggled through to the row.
    expect(eventInsert.args[0][0]).not.toHaveProperty("attacker_emp");
  });

  it("derives severity from the catalogue, not the request", async () => {
    const client = makeClient();
    await ingestBatch(client, {
      device: DEVICE,
      body: {
        events: [
          {
            type: "fake_gps",
            occurred_at: new Date().toISOString(),
            client_event_id: "a",
            severity: "low",
          },
        ],
      },
    });

    expect(callsOn(client, "device_events")[0].args[0][0].severity).toBe("critical");
  });

  it("upserts on the columns that actually have a unique index", async () => {
    // Regresses the partial-index problem: onConflict must name
    // (employee_id, client_event_id) and must ignore duplicates, or a retry
    // either errors or double-counts.
    const client = makeClient();
    await ingestBatch(client, {
      device: DEVICE,
      body: {
        events: [{ type: "power_off", occurred_at: new Date().toISOString(), client_event_id: "a" }],
      },
    });

    const [, options] = callsOn(client, "device_events")[0].args;
    expect(options.onConflict).toBe("employee_id,client_event_id");
    expect(options.ignoreDuplicates).toBe(true);
  });
});

describe("ingestBatch quota", () => {
  it("refuses before writing anything when over quota", async () => {
    const client = makeClient({ rpcResult: { data: false, error: null } });
    const result = await ingestBatch(client, {
      device: DEVICE,
      body: {
        events: [{ type: "power_off", occurred_at: new Date().toISOString(), client_event_id: "a" }],
      },
    });

    expect(result).toEqual({ error: "quota_exceeded", limit: 2000 });
    expect(callsOn(client, "device_events")).toHaveLength(0);
  });

  it("does not burn quota on an empty batch", async () => {
    const client = makeClient();
    const result = await ingestBatch(client, { device: DEVICE, body: {} });
    expect(result.message).toBe("empty batch");
    expect(client.calls.filter((c) => c.op === "rpc")).toHaveLength(0);
  });

  it("still consumes quota when every row was rejected", async () => {
    // The device did make a request; letting it retry bad rows for free is a loop.
    const client = makeClient();
    const result = await ingestBatch(client, { device: DEVICE, body: { events: [{ type: "nope" }] } });
    expect(result.rejected).toHaveLength(1);
    expect(client.calls.filter((c) => c.op === "rpc")).toHaveLength(1);
  });
});

describe("ingestBatch writes", () => {
  it("keeps valid rows when one row is rejected", async () => {
    const client = makeClient();
    const now = new Date().toISOString();
    const result = await ingestBatch(client, {
      device: DEVICE,
      body: {
        events: [
          { type: "power_off", occurred_at: now, client_event_id: "a" },
          { type: "nope", occurred_at: now, client_event_id: "b" },
        ],
      },
    });

    expect(callsOn(client, "device_events")[0].args[0]).toHaveLength(1);
    expect(result.events).toBe(1);
    expect(result.rejected).toHaveLength(1);
  });

  it("records the device heartbeat", async () => {
    const client = makeClient();
    await ingestBatch(client, {
      device: DEVICE,
      body: { events: [{ type: "power_off", occurred_at: new Date().toISOString(), client_event_id: "a" }] },
    });

    // last_sync_at on the profile, and last_used_at on the token, so "this phone
    // went quiet" is distinguishable from "this phone never existed".
    const profileUpsert = callsOn(client, "device_profiles").find((c) => c.op === "upsert");
    expect(profileUpsert.args[0].last_sync_at).toBeTruthy();

    const tokenUpdate = callsOn(client, "device_tokens").find((c) => c.op === "update");
    expect(tokenUpdate.args[0].last_used_at).toBeTruthy();
  });
});

describe("device token lifecycle", () => {
  it("stores only a hash, never the token", async () => {
    const client = makeClient({ single: { employees: ACTIVE_EMPLOYEE } });
    const { token } = await issueDeviceToken(client, {
      companyId: "co-1",
      employeeId: "emp-1",
      deviceId: "dev-1",
    });

    const row = callsOn(client, "device_tokens").find((c) => c.op === "upsert").args[0];
    expect(row.token_hash).toBe(hashToken(token));
    expect(JSON.stringify(row)).not.toContain(token);
    expect(token).not.toBe(row.token_hash);
  });

  it("refuses to enrol an employee who is not active", async () => {
    const client = makeClient({ single: { employees: { ...ACTIVE_EMPLOYEE, status: "archived" } } });
    const result = await issueDeviceToken(client, {
      companyId: "co-1",
      employeeId: "emp-1",
      deviceId: "dev-1",
    });

    expect(result.error).toBe("employee_unavailable");
    expect(callsOn(client, "device_tokens")).toHaveLength(0);
  });

  it("refuses a blank device id", async () => {
    expect(
      (await issueDeviceToken(makeClient({ single: { employees: ACTIVE_EMPLOYEE } }), {
        companyId: "co-1",
        employeeId: "emp-1",
        deviceId: "  ",
      })).error
    ).toBe("missing_device_id");
  });

  it("scopes a revoke to the company", async () => {
    const client = makeClient();
    await revokeDeviceToken(client, { companyId: "co-1", id: "tok-1" });
    const tokenCalls = callsOn(client, "device_tokens");

    expect(tokenCalls.find((c) => c.op === "update").args[0].revoked_at).toBeTruthy();
    // eq("company_id", ...) is what stops one tenant revoking another's token.
    expect(tokenCalls.some((c) => c.op === "eq" && c.args[0] === "company_id")).toBe(true);
    expect(tokenCalls.some((c) => c.op === "eq" && c.args[0] === "id")).toBe(true);
    // And `.is("revoked_at", null)` keeps it idempotent.
    expect(tokenCalls.some((c) => c.op === "is" && c.args[0] === "revoked_at")).toBe(true);
  });

  it("returns null when revoking something already revoked", async () => {
    const client = makeClient();
    // The `.is("revoked_at", null)` filter means no row matches, so maybeSingle
    // yields nothing: revocation is idempotent rather than an error.
    expect(await revokeDeviceToken(client, { companyId: "co-1", id: "gone" })).toBeNull();
  });
});

describe("authenticateDevice", () => {
  it("returns null without a token rather than hashing undefined", async () => {
    expect(await authenticateDevice(makeClient(), null)).toBeNull();
    expect(await authenticateDevice(makeClient(), "")).toBeNull();
  });
});