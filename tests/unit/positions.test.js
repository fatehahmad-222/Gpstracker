import { describe, it, expect } from "vitest";

import { evaluateFences } from "@/lib/monitor/geofence";
import { freshness, STALE_AFTER_MS, DROP_AFTER_MS } from "@/lib/server/positions";

/** Sialkot Head Office, matching the seeded geofences. */
const OFFICE = { lat: 32.4945, lng: 74.5229 };

describe("freshness", () => {
  it("treats a just-reported fix as live", () => {
    expect(freshness(0)).toBe("live");
    expect(freshness(60 * 1000)).toBe("live");
    expect(freshness(STALE_AFTER_MS)).toBe("live");
  });

  it("marks a fix older than five minutes stale", () => {
    expect(freshness(STALE_AFTER_MS + 1)).toBe("stale");
  });

  it("keeps a stale fix until the drop threshold", () => {
    expect(freshness(DROP_AFTER_MS)).toBe("stale");
  });

  it("gives up on a fix older than an hour", () => {
    expect(freshness(DROP_AFTER_MS + 1)).toBe("gone");
  });

  it("separates 'never reported' from 'the phone died'", () => {
    // These are different faults: one employee has no device or has not
    // started the app, the other had one and lost it.
    expect(freshness(null)).toBe("never");
    expect(freshness(undefined)).toBe("never");
    expect(freshness(STALE_AFTER_MS + 1)).not.toBe("never");
  });
});

describe("position fence annotation", () => {
  const office = {
    id: "f1",
    name: "Head Office",
    type: "circle",
    status: "active",
    radius_m: 200,
    center_lat: OFFICE.lat,
    center_lng: OFFICE.lng,
  };

  const warehouse = {
    id: "f2",
    name: "Warehouse",
    type: "circle",
    status: "active",
    radius_m: 200,
    center_lat: 32.6,
    center_lng: 74.7,
  };

  it("reports inside for a fix inside an assigned fence", () => {
    const r = evaluateFences([office], OFFICE);
    expect(r.inside).toBe(true);
    expect(r.matches.map((m) => m.fence_name)).toEqual(["Head Office"]);
  });

  it("reports outside for a fix that is nowhere near any assigned fence", () => {
    const r = evaluateFences([office], { lat: 31.5, lng: 74.1 });
    expect(r.inside).toBe(false);
    expect(r.matches).toEqual([]);
  });

  it("only matches against the fences that employee is assigned to", () => {
    // Physically inside the warehouse fence, but not assigned to it, so this is
    // an excursion rather than a site visit.
    const atWarehouse = { lat: 32.6, lng: 74.7 };
    expect(evaluateFences([office], atWarehouse).inside).toBe(false);
    expect(evaluateFences([warehouse], atWarehouse).inside).toBe(true);
  });

  it("ignores an inactive fence that is still assigned", () => {
    const retired = { ...warehouse, status: "inactive" };
    expect(evaluateFences([retired], { lat: 32.6, lng: 74.7 }).inside).toBe(false);
  });

  it("matches more than one overlapping fence and names both", () => {
    const near = { ...office, id: "f3", name: "Office Annexe", center_lat: OFFICE.lat + 0.0005 };
    const r = evaluateFences([office, near], OFFICE);
    expect(r.matches).toHaveLength(2);
    expect(r.matches.map((m) => m.fence_name).sort()).toEqual(["Head Office", "Office Annexe"]);
  });

  it("returns no matches rather than throwing for an empty assignment", () => {
    const r = evaluateFences([], OFFICE);
    expect(r.inside).toBe(false);
    expect(r.nearest).toBeNull();
  });
});