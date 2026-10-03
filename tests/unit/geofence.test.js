import { describe, it, expect } from "vitest";
import {
  haversineMeters,
  normalizeLng,
  rectanglePolygon,
  pointInPolygon,
  distanceToPolylineMeters,
  evaluateFence,
  evaluateFences,
  nearestFence,
  centroid,
} from "@/lib/monitor/geofence";

/** Sialkot Head Office, matching the seeded geofences. */
const OFFICE = { lat: 32.4945, lng: 74.5229 };
const point = (lat, lng) => ({ lat, lng });

describe("haversineMeters", () => {
  it("is zero for identical points", () => {
    expect(haversineMeters(OFFICE.lat, OFFICE.lng, OFFICE.lat, OFFICE.lng)).toBe(0);
  });

  it("matches a known short distance within 1%", () => {
    // 0.001 deg latitude is ~111 m everywhere.
    const d = haversineMeters(OFFICE.lat, OFFICE.lng, OFFICE.lat + 0.001, OFFICE.lng);
    expect(d).toBeGreaterThan(110);
    expect(d).toBeLessThan(112);
  });

  it("is symmetric", () => {
    const a = haversineMeters(32.4945, 74.5229, 32.6, 74.7);
    const b = haversineMeters(32.6, 74.7, 32.4945, 74.5229);
    expect(a).toBeCloseTo(b, 6);
  });
});

describe("normalizeLng", () => {
  it("wraps past 180 into negative space", () => {
    expect(normalizeLng(190)).toBeCloseTo(-170, 6);
  });

  it("wraps below -180", () => {
    expect(normalizeLng(-190)).toBeCloseTo(170, 6);
  });

  it("leaves in-range values alone", () => {
    expect(normalizeLng(74.5229)).toBeCloseTo(74.5229, 9);
  });
});

describe("rectanglePolygon", () => {
  it("produces a closed 5-point ring", () => {
    const ring = rectanglePolygon({ lat: 32.49, lng: 74.52 }, { lat: 32.5, lng: 74.53 });
    expect(ring).toHaveLength(5);
    expect(ring[0]).toEqual(ring[4]);
  });

  it("orders corners so the ring is not self-intersecting", () => {
    const ring = rectanglePolygon({ lat: 32.49, lng: 74.52 }, { lat: 32.5, lng: 74.53 });
    expect(ring[0]).toEqual([74.52, 32.49]);
    expect(ring[2]).toEqual([74.53, 32.5]);
  });
});

describe("pointInPolygon", () => {
  const square = rectanglePolygon({ lat: 32.49, lng: 74.52 }, { lat: 32.5, lng: 74.53 });

  it("accepts a point inside", () => {
    expect(pointInPolygon(point(32.495, 74.525), square)).toBe(true);
  });

  it("rejects a point outside", () => {
    expect(pointInPolygon(point(32.6, 74.7), square)).toBe(false);
  });

  it("respects holes", () => {
    const hole = [
      [74.523, 32.493],
      [74.527, 32.493],
      [74.527, 32.497],
      [74.523, 32.497],
      [74.523, 32.493],
    ];
    expect(pointInPolygon(point(32.495, 74.525), square, [hole])).toBe(false);
  });
});

describe("distanceToPolylineMeters", () => {
  it("is zero on the line", () => {
    const line = [
      [OFFICE.lng, OFFICE.lat],
      [OFFICE.lng + 0.01, OFFICE.lat],
    ];
    expect(distanceToPolylineMeters(point(OFFICE.lat, OFFICE.lng), line)).toBeLessThan(1);
  });

  it("measures the perpendicular offset", () => {
    const line = [
      [OFFICE.lng, OFFICE.lat],
      [OFFICE.lng + 0.01, OFFICE.lat],
    ];
    const d = distanceToPolylineMeters(point(OFFICE.lat + 0.001, OFFICE.lng + 0.005), line);
    expect(d).toBeGreaterThan(110);
    expect(d).toBeLessThan(112);
  });

  it("returns Infinity for an empty line", () => {
    expect(distanceToPolylineMeters(point(0, 0), [])).toBe(Infinity);
  });
});

describe("evaluateFence", () => {
  const circle = {
    type: "circle",
    radius_m: 250,
    center_lat: OFFICE.lat,
    center_lng: OFFICE.lng,
  };

  it("includes a point inside the radius", () => {
    const r = evaluateFence(circle, point(OFFICE.lat + 0.001, OFFICE.lng));
    expect(r.inside).toBe(true);
    expect(r.distance_m).toBeLessThan(250);
  });

  it("excludes a point outside the radius", () => {
    expect(evaluateFence(circle, point(OFFICE.lat + 0.01, OFFICE.lng)).inside).toBe(false);
  });

  it("applies the buffer on top of the radius", () => {
    // 0.001 deg lat is ~111 m, so this sits between the radius and radius+buffer.
    const r = evaluateFence({ ...circle, buffer_m: 50 }, point(OFFICE.lat + 0.0025, OFFICE.lng));
    expect(r.inside).toBe(false);
  });

  it("handles a polygon fence", () => {
    const polygon = {
      type: "polygon",
      geometry: {
        type: "Polygon",
        coordinates: [rectanglePolygon({ lat: 32.49, lng: 74.52 }, { lat: 32.5, lng: 74.53 })],
      },
    };
    expect(evaluateFence(polygon, point(32.495, 74.525)).inside).toBe(true);
    expect(evaluateFence(polygon, point(33.0, 75.0)).inside).toBe(false);
  });

  it("handles a rectangle fence", () => {
    const rect = {
      type: "rectangle",
      geometry: {
        type: "Polygon",
        coordinates: [rectanglePolygon({ lat: 32.49, lng: 74.52 }, { lat: 32.5, lng: 74.53 })],
      },
    };
    expect(evaluateFence(rect, point(32.495, 74.525)).inside).toBe(true);
  });

  it("handles a route fence with a corridor", () => {
    // Diagonal from the office heading north-east; the corridor is 100 m wide.
    const route = {
      type: "route",
      geometry: {
        type: "LineString",
        coordinates: [
          [OFFICE.lng, OFFICE.lat],
          [OFFICE.lng + 0.02, OFFICE.lat + 0.01],
        ],
      },
      buffer_m: 100,
    };

    // Midpoint of the line itself.
    const onRoute = point(OFFICE.lat + 0.005, OFFICE.lng + 0.01);
    expect(evaluateFence(route, onRoute).inside).toBe(true);

    // ~55 m off the line, still inside the 100 m corridor.
    const nearRoute = point(OFFICE.lat + 0.0055, OFFICE.lng + 0.01);
    expect(evaluateFence(route, nearRoute).inside).toBe(true);

    // Well off the line, outside the corridor.
    expect(evaluateFence(route, point(OFFICE.lat + 0.02, OFFICE.lng + 0.01)).inside).toBe(false);
  });

  it("returns outside for an unknown fence type rather than throwing", () => {
    const r = evaluateFence({ type: "hexagon" }, point(OFFICE.lat, OFFICE.lng));
    expect(r.inside).toBe(false);
  });

  it("tolerates a fence with no geometry", () => {
    expect(evaluateFence({ type: "polygon" }, point(0, 0)).inside).toBe(false);
  });
});

describe("evaluateFences", () => {
  const fences = [
    { id: "a", type: "circle", radius_m: 200, center_lat: OFFICE.lat, center_lng: OFFICE.lng, status: "active" },
    { id: "b", type: "circle", radius_m: 200, center_lat: 32.6, center_lng: 74.7, status: "active" },
    { id: "c", type: "circle", radius_m: 200, center_lat: 31.5, center_lng: 74.1, status: "inactive" },
  ];

  it("skips inactive fences", () => {
    const r = evaluateFences(fences, point(31.5, 74.1));
    expect(r.inside).toBe(false);
    expect(r.matches).toEqual([]);
  });

  it("finds the containing fence", () => {
    const r = evaluateFences(fences, point(OFFICE.lat, OFFICE.lng));
    expect(r.inside).toBe(true);
    expect(r.matches.map((m) => m.fence_id)).toEqual(["a"]);
  });

  it("limits to assigned fences when a list is given", () => {
    const r = evaluateFences(fences, point(OFFICE.lat, OFFICE.lng), ["b"]);
    expect(r.inside).toBe(false);
    expect(r.matches).toEqual([]);
  });

  it("still reports the nearest fence when outside", () => {
    const r = evaluateFences(fences, point(OFFICE.lat + 0.01, OFFICE.lng));
    expect(r.inside).toBe(false);
    expect(r.nearest.fence_id).toBe("a");
    expect(r.nearest.distance_m).toBeGreaterThan(200);
  });
});

describe("nearestFence", () => {
  const fences = [
    { id: "a", name: "Office", type: "circle", radius_m: 200, center_lat: OFFICE.lat, center_lng: OFFICE.lng },
    { id: "b", name: "Warehouse", type: "circle", radius_m: 200, center_lat: 32.6, center_lng: 74.7 },
  ];

  it("picks the closest fence by distance", () => {
    expect(nearestFence(fences, point(32.6001, 74.7)).fence_id).toBe("b");
  });

  it("returns null when there are no fences", () => {
    expect(nearestFence([], point(0, 0))).toBeNull();
  });
});

describe("centroid", () => {
  it("averages the coordinates", () => {
    const c = centroid([
      [74.52, 32.49],
      [74.54, 32.51],
    ]);
    expect(c.lng).toBeCloseTo(74.53, 6);
    expect(c.lat).toBeCloseTo(32.5, 6);
  });

  it("returns null for empty input", () => {
    expect(centroid([])).toBeNull();
  });
});