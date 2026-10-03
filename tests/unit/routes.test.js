import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Route-level auth coverage.
 *
 * Every API route in this product is either a session route or a device route,
 * and there is no third category. A route that forgets its guard is
 * unauthenticated by default, because nothing else in the stack adds
 * authentication for it: Next.js will happily serve whatever the handler returns.
 *
 * Phase 9 found that a whole surface of ingestion was missing rather than that a
 * guard had been dropped, so this test is about the property that would catch the
 * second kind of mistake - a new route added without thinking about auth.
 */

const API_DIR = join(process.cwd(), "app", "api");

/** Walk the route tree; readdirSync + statSync keeps bracket paths literal. */
function findRoutes(dir) {
  const found = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      found.push(...findRoutes(full));
    } else if (entry === "route.js") {
      found.push(full);
    }
  }
  return found;
}

const routes = findRoutes(API_DIR).map((full) => {
  const text = readFileSync(full, "utf8");
  const rel = relative(API_DIR, full).replace(/\\/g, "/").replace(/\/route\.js$/, "");
  const handlers = [...text.matchAll(/export async function (GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)/g)].map(
    (m) => m[1]
  );
  return {
    rel,
    text,
    handlers,
    usesContext: /requireContext/.test(text),
    usesLegacyGuard: /resolveAuth/.test(text),
    usesDeviceToken: /bearerToken|authenticateDevice/.test(text),
    referencesCompany: /companyId|company_id/.test(text),
  };
});

describe("route inventory", () => {
  it("finds the API routes", () => {
    expect(routes.length).toBeGreaterThan(15);
  });

  it("gives every route at least one handler", () => {
    const bare = routes.filter((r) => r.handlers.length === 0).map((r) => r.rel);
    expect(bare).toEqual([]);
  });
});

describe("every route is authenticated", () => {
  it("has exactly one authentication strategy", () => {
    const strategies = (r) =>
      [r.usesContext && "session", r.usesLegacyGuard && "legacy-session", r.usesDeviceToken && "device-token"].filter(
        Boolean
      );

    const ambiguous = routes
      .map((r) => ({ rel: r.rel, s: strategies(r) }))
      // A device route also mentions requireContext nowhere; but a session route
      // that also parses a bearer token would be two identities in one handler.
      .filter((x) => x.s.length !== 1)
      .map((x) => `${x.rel} [${x.s.join(",") || "none"}]`);

    expect(ambiguous).toEqual([]);
  });

  it("has no route with no guard at all", () => {
    const unguarded = routes
      .filter((r) => !r.usesContext && !r.usesLegacyGuard && !r.usesDeviceToken)
      .map((r) => r.rel);
    expect(unguarded).toEqual([]);
  });
});

describe("monitor routes", () => {
  const monitor = routes.filter((r) => r.rel.startsWith("monitor/"));

  it("exist", () => {
    expect(monitor.length).toBeGreaterThan(15);
  });

  it("all use the shared session context helper", () => {
    // requireContext is what supplies companyId and the write-permission check.
    // A monitor route rolling its own auth is how the role rules drift from the
    // layout that guards the same page.
    const odd = monitor.filter((r) => !r.usesContext).map((r) => r.rel);
    expect(odd).toEqual([]);
  });

  it("all reference the company scope", () => {
    const unscoped = monitor.filter((r) => !r.referencesCompany).map((r) => r.rel);
    expect(unscoped).toEqual([]);
  });

  it("never reads a device token", () => {
    // Device credentials are not a session. A monitor route accepting one would
    // hand an anonymous caller the whole tenant view.
    const mixed = monitor.filter((r) => r.usesDeviceToken).map((r) => r.rel);
    expect(mixed).toEqual([]);
  });
});

describe("device route", () => {
  const ingest = routes.find((r) => r.rel === "track/ingest");

  it("exists", () => {
    expect(ingest).toBeDefined();
  });

  it("authenticates by device token, not by session", () => {
    expect(ingest.usesDeviceToken).toBe(true);
    expect(ingest.usesContext).toBe(false);
  });

  it("does not take a company or employee from the request", () => {
    // Both come from the token row. A body or query parameter would let one
    // handset write telemetry into another tenant.
    expect(ingest.referencesCompany).toBe(false);
    expect(ingest.text).not.toMatch(/searchParams\.get\(\s*["']company/);
    expect(ingest.text).not.toMatch(/body\.\s*company_id/);
    expect(ingest.text).not.toMatch(/body\.\s*employee_id/);
  });

  it("refuses GET rather than leaving a readable endpoint", () => {
    expect(ingest.handlers).toContain("GET");
    expect(ingest.text).toMatch(/method_not_allowed/);
  });
});