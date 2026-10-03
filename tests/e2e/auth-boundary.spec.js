import { test, expect } from "@playwright/test";

/**
 * Auth-boundary E2E tests.
 *
 * Everything here is deliberately reachable with no database and no seeded
 * account, because a test that needs a live Supabase project is a test that does
 * not run. These assert the two boundaries that matter most and that must hold
 * even when everything else is misconfigured:
 *
 *  1. No monitor page renders for an anonymous visitor.
 *  2. The anonymous device endpoint refuses before it touches anything.
 *
 * The device endpoint is the one surface on this product reachable without a
 * session, so its refusal is asserted on the wire rather than through the UI.
 */

const MONITOR_PAGES = [
  "/monitor",
  "/monitor/live-map",
  "/monitor/employees",
  "/monitor/alerts",
  "/monitor/attendance",
  "/monitor/configuration/devices",
];

test.describe("anonymous page access", () => {
  for (const path of MONITOR_PAGES) {
    test(`${path} redirects to sign-in`, async ({ page }) => {
      await page.goto(path);
      await expect(page).toHaveURL(/\/login/);
    });
  }

  test("a sign-in page is reachable without a session", async ({ page }) => {
    // Guards against the redirect loop the tests above would not otherwise catch:
    // if /login itself redirected, every assertion would still pass.
    const response = await page.goto("/login");
    expect(response.status()).toBe(200);
    await expect(page).toHaveURL(/\/login/);
  });

  test("legacy /dashboard still redirects to sign-in", async ({ page }) => {
    // The monitor module must not have disturbed the pre-existing console.
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login/);
    await expect(page).toHaveURL(/next=/);
  });

  test("legacy /app still redirects to sign-in", async ({ page }) => {
    await page.goto("/app");
    await expect(page).toHaveURL(/\/login/);
    await expect(page).toHaveURL(/next=/);
  });
});

test.describe("device ingestion endpoint", () => {
  const INGEST = "/api/track/ingest";

  test("refuses a POST with no Authorization header", async ({ request }) => {
    const response = await request.post(INGEST, { data: { events: [], pings: [] } });
    expect(response.status()).toBe(401);
    // `unauthorized()` puts the reason in `error`, so assert it says something
    // rather than pinning the exact wording.
    expect((await response.json()).error).toBeTruthy();
  });

  test("refuses a POST with a non-bearer scheme", async ({ request }) => {
    // A session cookie must not be a way in. This endpoint takes a device token
    // and nothing else, so a browser session gets no special treatment.
    const response = await request.post(INGEST, {
      headers: { authorization: "Basic YWRtaW46YWRtaW4=" },
      data: { events: [], pings: [] },
    });
    expect(response.status()).toBe(401);
  });

  test("refuses a POST with an empty bearer token", async ({ request }) => {
    const response = await request.post(INGEST, {
      headers: { authorization: "Bearer " },
      data: { events: [], pings: [] },
    });
    expect(response.status()).toBe(401);
  });

  test("never accepts a body from an unknown token", async ({ request }) => {
    // The claim is deliberately about the outcome rather than a status code: a
    // made-up token must not produce a success under any deployment. It is a 401
    // when the server can reach Supabase and a 500 when it cannot, and both are
    // refusals. What must never happen is a 2xx.
    const response = await request.post(INGEST, {
      headers: { authorization: "Bearer not-a-real-token", "content-type": "application/json" },
      data: { padding: "x".repeat(600 * 1024) },
    });
    expect(response.ok()).toBe(false);
    expect(response.status()).toBeGreaterThanOrEqual(400);
  });

  test("returns a clean error when ingestion is unconfigured", async ({ request }) => {
    // No SUPABASE_SERVICE_ROLE_KEY in this environment. Building the admin client
    // throws on that, and it throws before the route's try/catch, so an
    // unconfigured deployment used to answer anonymous callers with an unhandled
    // exception. A diagnosable 500 is the contract.
    const response = await request.post(INGEST, {
      headers: { authorization: "Bearer not-a-real-token" },
      data: { events: [], pings: [] },
    });
    if (response.status() === 500) {
      expect((await response.json()).error).toBeTruthy();
    } else {
      // Reachable Supabase: the token simply is not a real one.
      expect(response.status()).toBe(401);
    }
  });

  test("has no GET", async ({ request }) => {
    const response = await request.get(INGEST);
    expect(response.status()).toBe(405);
  });
});

test.describe("staff-only API surface", () => {
  const STAFF_ROUTES = [
    "/api/monitor/device-tokens",
    "/api/monitor/employees",
    "/api/monitor/dashboard",
    "/api/monitor/alerts",
  ];

  for (const path of STAFF_ROUTES) {
    test(`${path} is closed to anonymous callers`, async ({ request }) => {
      const response = await request.get(path);
      expect(response.status()).toBe(401);
    });
  }
});