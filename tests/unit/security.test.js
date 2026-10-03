import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Static analysis of the migrations, asserting on the *effective* schema state.
 *
 * These are the invariants that are cheap to state and expensive to discover in
 * production, and none of them can be checked by a unit test: the holes found in
 * phase 9 - a global `is_admin()` used as a tenant boundary, an
 * `is_company_admin()` that never referenced a company, six `with check (true)`
 * policies, and a `companies` table with RLS off plus an explicit anon grant -
 * were all invisible until the SQL was read closely, and would have stayed
 * invisible without a project to run against.
 *
 * Asserting on the concatenated text of every migration is the obvious approach
 * and it is wrong: a policy corrected in 0014 is still present, un-dropped, in
 * 0007, and PostgreSQL applies the last statement. So this walks the migrations in
 * order and tracks drop/create/revoke the way the database would.
 */

const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");

const files = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort();

/** Strip `--` comments so prose describing a policy is not read as the policy. */
function stripComments(text) {
  return text.replace(/--[^\n]*/g, "");
}

/** Split into statements, so a regex cannot match across a `;` into the next one. */
function statements(text) {
  return stripComments(text)
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
}

const ordered = [];
for (const file of files) {
  const text = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
  for (const stmt of statements(text)) ordered.push({ file, stmt });
}

/**
 * Replay the migrations to find what a fresh database would actually enforce.
 */
function effectiveState() {
  const rls = new Set();
  const policies = new Map(); // name -> { table, stmt }
  const indexes = new Map(); // name -> { table, stmt }
  const anonSelect = new Set();
  const anonOther = new Map();

  for (const { file, stmt } of ordered) {
    const flat = stmt.replace(/\s+/g, " ");

    const rlsOn = flat.match(/alter table public\.(\w+) enable row level security/i);
    if (rlsOn) rls.add(rlsOn[1]);

    const dropped = flat.match(/drop policy if exists "?(\w+)"? on public\.(\w+)/i);
    if (dropped) policies.delete(dropped[1]);

    const created = flat.match(/create policy "?([\w]+)"? on public\.(\w+)/i);
    if (created) {
      policies.set(created[1], { name: created[1], table: created[2], stmt: flat, file });
      continue;
    }

    // The 0004 / 0014 org-tree blocks build these inside a plpgsql loop over an
    // array literal, so the policy name and table come from the array.
    const dynamic = flat.match(/array\[([^\]]+)\]/);
    if (dynamic && /create policy %I on public\.%I/.test(flat)) {
      for (const raw of dynamic[1].split(",")) {
        const t = raw.trim().replace(/^'|'$/g, "");
        if (!t) continue;
        const suffix = flat.match(/%I \|\| '(\w+)'/);
        const suffix2 = flat.match(/t \|\| '(\w+)'/);
        const kind = (suffix || suffix2)?.[1];
        if (!kind) continue;
        policies.set(`${t}_${kind}`, { name: `${t}_${kind}`, table: t, stmt: flat, file });
      }
    }

    const idxDropped = flat.match(/drop index if exists (?:public\.)?(\w+)/i);
    if (idxDropped) indexes.delete(idxDropped[1]);

    const idxCreated = flat.match(/create (unique )?index if not exists (?:public\.)?(\w+) on public\.(\w+) \(([^)]*)\)([\s\S]*)/i);
    if (idxCreated) {
      indexes.set(idxCreated[2], {
        name: idxCreated[2],
        table: idxCreated[3],
        columns: idxCreated[4],
        unique: Boolean(idxCreated[1]),
        predicate: (idxCreated[5] || "").trim(),
        stmt: flat,
        file,
      });
      continue;
    }

    const revoked = flat.match(/revoke ([\w\s]+?) on table public\.(\w+) from ([\w,\s]+)/i);
    if (revoked) {
      const [, , table, roles] = revoked;
      for (const role of roles.split(",").map((r) => r.trim())) {
        if (role === "anon") anonSelect.delete(table);
      }
      continue;
    }

    const revokeFn = flat.match(/revoke execute on function (?:public\.)?(\w+)\s*\(/i);
    if (revokeFn && /\banon\b/.test(flat)) anonOther.delete(`fn:${revokeFn[1]}`);

    // A grant on a function that no longer exists is not a live grant, so drop
    // it from the effective state rather than reporting it.
    const fnDropped = flat.match(/drop function (?:if exists )?(?:public\.)?(\w+)/i);
    if (fnDropped) anonOther.delete(`fn:${fnDropped[1]}`);

    const granted = flat.match(/grant ([\w\s]+?) on table public\.(\w+) to ([\w,\s]+)/i);
    if (granted) {
      const [, , table, roles] = granted;
      for (const role of roles.split(",").map((r) => r.trim())) {
        if (role === "anon") {
          if (/\bselect\b/i.test(granted[1])) anonSelect.add(table);
          else anonOther.set(table, granted[1].trim());
        }
      }
      continue;
    }

    const grantFn = flat.match(/grant execute on function (?:public\.)?(\w+)\s*\(/i);
    if (grantFn && /\banon\b/.test(flat)) anonOther.set(`fn:${grantFn[1]}`, "execute");
  }

  return { rls, policies, indexes, anonSelect, anonOther };
}

const state = effectiveState();
const policyList = [...state.policies.values()];

describe("migration inventory", () => {
  it("finds the migrations", () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it("numbers them without gaps", () => {
    const numbers = files.map((f) => Number(f.slice(0, 4)));
    numbers.forEach((n, i) => {
      if (i > 0) expect(n).toBe(numbers[i - 1] + 1);
    });
  });
});

describe("row level security, effective state", () => {
  it("is enabled on every table the schema creates", () => {
    const created = ordered
      .map(({ stmt }) => stmt.match(/create table if not exists public\.(\w+)/i))
      .filter(Boolean)
      .map((m) => m[1]);

    const unprotected = [...new Set(created)].filter((t) => !state.rls.has(t));
    expect(unprotected).toEqual([]);
  });

  it("enables RLS on companies, which shipped switched off", () => {
    // 0003 granted select to anon and nothing ever turned RLS on, so every
    // company row - including the settings jsonb of risk weights and quotas -
    // was world readable.
    expect(state.rls.has("companies")).toBe(true);
  });

  it("enables RLS on api_usage_counters", () => {
    expect(state.rls.has("api_usage_counters")).toBe(true);
  });

  it("leaves no policy that grants unconditionally", () => {
    const offenders = policyList
      .filter((p) => /with check\s*\(\s*true\s*\)|using\s*\(\s*true\s*\)/.test(p.stmt))
      .map((p) => `${p.name} (${p.file})`);
    expect(offenders).toEqual([]);
  });

  it("never treats a bare admin check as a tenant boundary", () => {
    // The systemic phase 9 bug: is_admin(), is_company_admin() and
    // can_company_write() all ask "is the caller an admin of some company".
    // An admin predicate is only safe alongside same_company(company_id).
    const offenders = policyList
      .filter(
        (p) =>
          /\b(is_admin|is_company_admin|can_company_write)\s*\(\s*\)/.test(p.stmt) &&
          !/same_company\s*\(/.test(p.stmt)
      )
      .map((p) => `${p.name} (${p.file})`);
    expect(offenders).toEqual([]);
  });

  it("scopes every admin write policy to the row's own company", () => {
    const offenders = policyList
      .filter((p) => /for (insert|update|delete)/.test(p.stmt) && /is_company_admin_for\s*\(\s*company_id\s*\)/.test(p.stmt))
      .filter((p) => !/same_company\s*\(|is_company_admin_for\s*\(\s*company_id\s*\)/.test(p.stmt))
      .map((p) => p.name);
    expect(offenders).toEqual([]);
  });

  it("grants no table read to anon", () => {
    expect([...state.anonSelect]).toEqual([]);
  });

  it("grants no function execute to anon either", () => {
    // is_admin() was reachable by anonymous callers. Answering false is harmless,
    // but a blanket anon grant on a function is how the next one becomes a hole.
    expect([...state.anonOther.keys()].filter((k) => k.startsWith("fn:"))).toEqual([]);
  });
});

describe("security definer functions", () => {
  const definerFns = ordered.flatMap(({ file, stmt }) => {
    const flat = stmt.replace(/\s+/g, " ");
    if (!/security definer/i.test(flat)) return [];
    const name = flat.match(/function\s+(?:public\.)?(\w+)/)?.[1] ?? "unknown";
    return [{ name, file, pinned: /set search_path/i.test(flat) }];
  });

  it("finds the security definer functions", () => {
    expect(definerFns.length).toBeGreaterThan(10);
  });

  it("pins search_path on every one of them", () => {
    // A SECURITY DEFINER function with a mutable search_path can be made to run
    // attacker-controlled code by shadowing a name in a writable schema.
    const offenders = definerFns.filter((f) => !f.pinned).map((f) => `${f.name} (${f.file})`);
    expect(offenders).toEqual([]);
  });

  it("has removed the zero-argument admin helpers", () => {
    // They read like tenant boundaries and are not. Dropping them turns a
    // future cross-tenant policy into an error instead of a breach.
    const lastState = (fn) =>
      ordered
        .filter(({ stmt }) =>
          new RegExp(`(create|drop)\\s+(or\\s+replace\\s+)?function\\s+(if\\s+exists\\s+)?(public\\.)?${fn}\\s*\\(`).test(
            stmt.replace(/\s+/g, " ")
          )
        )
        .pop();

    for (const fn of ["is_company_admin", "can_company_write"]) {
      expect(lastState(fn)?.stmt).toMatch(/^drop function/);
    }
  });
});

describe("device write path", () => {
  const all = ordered.map(({ stmt }) => stmt.replace(/\s+/g, " ")).join("\n");

  it("keeps device_tokens closed to every authenticated role", () => {
    // Zero policies is the correct state, not an oversight.
    const tokenPolicies = policyList.filter((p) => p.table === "device_tokens");
    expect(tokenPolicies).toEqual([]);
    expect(state.rls.has("device_tokens")).toBe(true);
  });

  it("does not let a user write raw device_events", () => {
    // Forging a fake_gps row against a colleague is the single most damaging
    // thing an authenticated user could do in this product.
    expect(policyList.some((p) => p.table === "device_events" && /for (insert|update|delete)/.test(p.stmt))).toBe(
      false
    );
  });

  it("does not let a user write device_profiles", () => {
    expect(
      policyList.some((p) => p.table === "device_profiles" && /for (insert|update|delete)/.test(p.stmt))
    ).toBe(false);
  });

  it("does not let a user fabricate violations", () => {
    // Violations are raised only by the SECURITY DEFINER jobs.
    expect(policyList.some((p) => p.table === "violations" && /for insert/.test(p.stmt))).toBe(false);
  });

  it("uses a non-partial unique index for the event idempotency key", () => {
    // PostgREST cannot send an index predicate, so a partial unique index makes
    // onConflict=employee_id,client_event_id unresolvable at runtime. Asserted
    // on the effective index set, not on the SQL text: 0007 still contains the
    // partial definition, but 0014 drops it.
    const onClientId = [...state.indexes.values()].filter(
      (ix) => ix.table === "device_events" && /client_event_id/.test(ix.columns)
    );

    expect(onClientId.length).toBeGreaterThan(0);
    for (const ix of onClientId) {
      expect(ix.unique).toBe(true);
      expect(ix.predicate).not.toMatch(/where/i);
    }
  });

  it("stores device events at every severity the catalogue can emit", () => {
    // admin_logout, old_app and battery_low are low severity, so a check
    // constraint without 'low' rejects them.
    const constraint = all.match(/add constraint device_events_severity_check check \(([^)]*)\)/i);
    expect(constraint).not.toBeNull();
    for (const level of ["critical", "high", "medium", "low"]) {
      expect(constraint[1]).toContain(level);
    }
  });

  it("keeps violations strict, because violations are the triage queue", () => {
    // The deliberate opposite asymmetry to device_events: low-severity events are
    // evidence worth keeping, but a low-severity item in a queue a supervisor has
    // to work through is noise.
    const create = ordered.find(({ stmt }) =>
      /create table if not exists public\.violations\s*\(/i.test(stmt.replace(/\s+/g, " "))
    );
    expect(create).toBeDefined();

    const severity = create.stmt.replace(/\s+/g, " ").match(/severity[^;]*?check \(severity in \(([^)]*)\)\)/i);
    expect(severity).not.toBeNull();
    expect(severity[1]).not.toMatch(/'low'/);
  });
});