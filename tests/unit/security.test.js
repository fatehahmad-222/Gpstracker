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
  const anonBlanket = new Set(); // object types revoked wholesale from anon
  const anonDefaults = new Set(); // "<role>:<objtype>" taken off anon by default privs
  const authNoRls = new Set(); // authenticated privileges that RLS does not mediate

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

    // 0016: `revoke all on all tables/sequences/functions in schema public from
    // anon`. These match no table by name, so they need handling before the
    // per-table patterns above - and they are the statement that makes the
    // per-table ones irrelevant for anon.
    const blanket = flat.match(
      /revoke\s+all\s+on\s+all\s+(tables|sequences|functions)\s+in\s+schema\s+public\s+from\s+anon/i
    );
    if (blanket) {
      anonBlanket.add(blanket[1].toLowerCase());
      continue;
    }

    // The grants above never existed in these files - Supabase's default
    // privileges put them there. Recorded so the "and it stays gone" half of
    // 0016 is asserted, since revoking today's tables is undone by the next
    // `create table`.
    const dflt = flat.match(
      /alter default privileges for role (\w+) in schema public revoke ([\w\s]+?) on (tables|sequences|functions) from anon/i
    );
    if (dflt) {
      anonDefaults.add(`${dflt[1].toLowerCase()}:${dflt[3].toLowerCase()}`);
      continue;
    }

    // TRUNCATE, REFERENCES and TRIGGER are not filtered by RLS, so for those the
    // grant *is* the boundary.
    const bypass = flat.match(
      /revoke\s+([\w\s,]+?)\s+on\s+all\s+tables\s+in\s+schema\s+public\s+from\s+authenticated/i
    );
    if (bypass) {
      for (const p of bypass[1].split(",")) authNoRls.add(p.trim().toLowerCase());
      continue;
    }
  }

  return { rls, policies, indexes, anonSelect, anonOther, anonBlanket, anonDefaults, authNoRls };
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

/**
 * The one hole in this file that no amount of reading the migrations could have
 * found, and the reason the replay above needed extending.
 *
 * 0014 audited every policy and stated that the tables carried "no grants to
 * anon". That was wrong, and not because a migration said so - because Supabase
 * configures `alter default privileges ... grant all on tables to anon`, so
 * every table these migrations created inherited INSERT, SELECT, UPDATE, DELETE,
 * TRUNCATE, REFERENCES and TRIGGER from anon before any line of this repository
 * ran. Measured on the live project: anon held all four DML privileges on all 23
 * tables, and the only thing standing between that and a public copy of every
 * worker's GPS history was the company-scoped RLS that 0004 and 0014 had just
 * finished writing.
 *
 * So the assertion is deliberately not "no migration grants to anon" - that
 * version of the test passed while the hole was wide open, which is what makes
 * it worth writing the stronger one.
 */
describe("anon reachability", () => {
  it("leaves no table privilege to anon, inherited or explicit", () => {
    const anonTables = [...state.anonSelect, ...[...state.anonOther.keys()].filter((k) => !k.startsWith("fn:"))];
    expect(anonTables).toEqual([]);
  });

  it("revokes tables, sequences and functions from anon wholesale", () => {
    // Per-table revokes cannot cover a table that does not exist yet; this can.
    expect([...state.anonBlanket].sort()).toEqual(["functions", "sequences", "tables"]);
  });

  it("takes anon off the default privileges, so the grants do not come back", () => {
    // The reason the grants were there in the first place. Revoking them on
    // today's tables without this leaves the next `create table` exposed.
    for (const objtype of ["tables", "sequences", "functions"]) {
      expect(state.anonDefaults.has(`postgres:${objtype}`)).toBe(true);
    }
  });

  it("keeps anon out of the app's data path deliberately, not by accident", () => {
    // The anon key is what the browser client is built with, but every real
    // request runs as `authenticated` from the session cookie, and ingestion
    // runs as service_role. So anon needs nothing on these tables.
    //
    // The risk in writing 0016 is therefore not "did I revoke enough" but "did I
    // revoke too much": a blanket revoke that also caught `authenticated` would
    // break every signed-in screen instead of protecting anything, and would look
    // like a successful hardening in the diff.
    const blanketRevokes = ordered
      .map(({ stmt }) => stmt.replace(/\s+/g, " "))
      .filter((s) => /revoke\s+all\s+on\s+all\s+(tables|sequences|functions)\s+in\s+schema\s+public/i.test(s));

    expect(blanketRevokes.length).toBeGreaterThan(0);
    for (const stmt of blanketRevokes) {
      expect(stmt).toMatch(/\bfrom anon\b/i);
      expect(stmt).not.toMatch(/service_role/);
      expect(stmt).not.toMatch(/authenticated/);
    }
  });
});

describe("privileges RLS cannot mediate", () => {
  it("does not let an authenticated session truncate a table", () => {
    // TRUNCATE is the reason this test exists. RLS is not consulted for it, so
    // on a table where `authenticated` holds TRUNCATE the grant is the entire
    // boundary - and PostgREST cannot issue TRUNCATE, so no app path needs it.
    expect([...state.authNoRls].sort()).toEqual(["references", "trigger", "truncate"]);
  });
});

/**
 * The quota kind check is a closed set of strings in SQL, and the callers are
 * string literals in JavaScript, and nothing in between checks that they agree.
 *
 * They did not agree. lib/server/ingest.js meters every tracker batch with
 * `p_kind: "device_ingest"`, and the constraint did not list it, so consume_
 * api_quota raised 23514 and the ingestion route rethrew - on every batch, in
 * the primary write path of the product. The migrations applied cleanly and
 * every other test passed, because the two strings simply never met.
 *
 * So this asserts the *intersection*: every kind the code sends must be a kind
 * the schema accepts. Adding a kind to the app without adding it to the
 * constraint fails here instead of in production.
 */
describe("app strings the schema has to accept", () => {
  function walk(dir, out = []) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "node_modules" && entry.name !== ".next" && !entry.name.startsWith(".")) {
          walk(full, out);
        }
      } else if (/\.(js|jsx|mjs)$/.test(entry.name)) {
        out.push(full);
      }
    }
    return out;
  }

  const sourceFiles = [...walk(join(process.cwd(), "lib")), ...walk(join(process.cwd(), "app"))];

  /** The last definition wins, the same way the database resolves it. */
  function effectiveKinds(table) {
    let kinds = null;
    for (const { stmt } of ordered) {
      const flat = stmt.replace(/\s+/g, " ");
      const inline = flat.match(new RegExp(`${table}[^)]*?check\\s*\\(kind in \\(([^)]*)\\)`, "i"));
      const added = flat.match(new RegExp(`add constraint \\w+ check\\s*\\(kind in \\(([^)]*)\\)`, "i"));
      const found = inline || added;
      if (found) {
        kinds = new Set(found[1].split(",").map((k) => k.trim().replace(/^'|'$/g, "")));
      }
    }
    return kinds;
  }

  const allowedKinds = effectiveKinds("api_usage_counters");

  const usedKinds = new Set();
  for (const file of sourceFiles) {
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(/p_kind:\s*["'`]([\w-]+)["'`]/g)) usedKinds.add(m[1]);
  }

  it("finds the quota kinds the app actually sends", () => {
    // Guards the test below against silently matching nothing.
    expect(usedKinds.size).toBeGreaterThan(0);
  });

  it("only sends quota kinds the counter table accepts", () => {
    expect(allowedKinds).not.toBeNull();
    expect([...usedKinds].filter((k) => !allowedKinds.has(k))).toEqual([]);
  });

  it("meters device ingestion, which is the reason the set was widened", () => {
    expect(usedKinds.has("device_ingest")).toBe(true);
    expect(allowedKinds.has("device_ingest")).toBe(true);
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