import { describe, it, expect } from "vitest";

import {
  circleGeometry,
  rectangleGeometry,
  polygonGeometry,
  routeGeometry,
  buildGeometry,
  polylineLengthKm,
  estimateMinutes,
  fenceVertices,
  fenceBounds,
  fenceCenter,
} from "@/lib/monitor/geojson";
import { geofenceSchema } from "@/lib/monitor/validation";
import { toGeofenceRow } from "@/lib/server/geofences";

/** Sialkot Head Office, matching the seeded geofences. */
const OFFICE = { lat: 32.4945, lng: 74.5229 };

// A circle is addressed by its centre columns, not by a {lat,lng} point,
// because that is what the API and the database use.
const CIRCLE = { center_lat: OFFICE.lat, center_lng: OFFICE.lng };

describe("circleGeometry", () => {
  it("emits a GeoJSON Point in lng/lat order", () => {
    expect(circleGeometry(CIRCLE)).toEqual({ type: "Point", coordinates: [74.5229, 32.4945] });
  });

  it("rejects a non-numeric coordinate instead of writing NaN", () => {
    expect(() => circleGeometry({ center_lat: "abc", center_lng: 74 })).toThrow(TypeError);
  });
});

describe("rectangleGeometry", () => {
  const NE = { north: 32.5, south: 32.49, east: 74.53, west: 74.52 };

  it("closes the ring", () => {
    const ring = rectangleGeometry(NE).coordinates[0];
    expect(ring).toHaveLength(5);
    expect(ring[0]).toEqual(ring[4]);
  });

  it("normalises corners given in any drag order", () => {
    const dragged = rectangleGeometry({ north: 32.49, south: 32.5, east: 74.52, west: 74.53 });
    expect(dragged).toEqual(rectangleGeometry(NE));
  });
});

describe("polygonGeometry", () => {
  it("closes an open ring", () => {
    const ring = polygonGeometry([
      { lat: 32.49, lng: 74.52 },
      { lat: 32.5, lng: 74.52 },
      { lat: 32.5, lng: 74.53 },
    ]).coordinates[0];
    expect(ring).toHaveLength(4);
    expect(ring[0]).toEqual(ring[3]);
  });

  it("does not double-close a ring the user already closed", () => {
    const ring = polygonGeometry([
      { lat: 32.49, lng: 74.52 },
      { lat: 32.5, lng: 74.52 },
      { lat: 32.5, lng: 74.53 },
      { lat: 32.49, lng: 74.52 },
    ]).coordinates[0];
    expect(ring).toHaveLength(4);
  });

  it("refuses fewer than 3 points", () => {
    expect(() => polygonGeometry([OFFICE, OFFICE])).toThrow(TypeError);
  });
});

describe("routeGeometry", () => {
  it("keeps origin, waypoints and destination in travel order", () => {
    const geometry = routeGeometry({
      origin: { lat: 32.49, lng: 74.52 },
      waypoints: [{ lat: 32.5, lng: 74.53 }],
      destination: { lat: 32.51, lng: 74.54 },
    });
    expect(geometry.type).toBe("LineString");
    expect(geometry.coordinates).toEqual([
      [74.52, 32.49],
      [74.53, 32.5],
      [74.54, 32.51],
    ]);
  });

  it("refuses a route with only one end", () => {
    expect(() => routeGeometry({ origin: OFFICE, destination: null })).toThrow(TypeError);
  });
});

describe("polylineLengthKm", () => {
  it("is zero for an empty or single-point line", () => {
    expect(polylineLengthKm([])).toBe(0);
    expect(polylineLengthKm([[74.52, 32.49]])).toBe(0);
  });

  it("sums the legs", () => {
    // 0.01 deg latitude is ~1.11 km.
    const km = polylineLengthKm([
      [74.52, 32.49],
      [74.52, 32.5],
    ]);
    expect(km).toBeGreaterThan(1.1);
    expect(km).toBeLessThan(1.12);
  });

  it("rounds to 2dp so the stored value is stable", () => {
    expect(polylineLengthKm([[0, 0], [0.123456789, 0.987654321]])).toBe(
      Number(polylineLengthKm([[0, 0], [0.123456789, 0.987654321]]).toFixed(2))
    );
  });
});

describe("estimateMinutes", () => {
  it("is zero for no distance", () => {
    expect(estimateMinutes(0, "Driving")).toBe(0);
  });

  it("is slower for walking than driving", () => {
    expect(estimateMinutes(10, "Walking")).toBeGreaterThan(estimateMinutes(10, "Driving"));
  });

  it("never rounds a real journey down to zero", () => {
    expect(estimateMinutes(0.01, "Driving")).toBe(1);
  });

  it("falls back to driving for an unknown mode", () => {
    expect(estimateMinutes(10, "Teleport")).toBe(estimateMinutes(10, "Driving"));
  });
});

describe("buildGeometry", () => {
  it("derives the centre and radius for a circle", () => {
    const built = buildGeometry("circle", { center_lat: OFFICE.lat, center_lng: OFFICE.lng, radius_m: 250 });
    expect(built.geometry).toEqual({ type: "Point", coordinates: [74.5229, 32.4945] });
    expect(built.center_lat).toBe(32.4945);
    expect(built.radius_m).toBe(250);
  });

  it("refuses a circle with no radius rather than storing an unusable fence", () => {
    expect(() => buildGeometry("circle", { center_lat: OFFICE.lat, center_lng: OFFICE.lng, radius_m: 0 })).toThrow(TypeError);
  });

  it("centres a rectangle from its corners", () => {
    const built = buildGeometry("rectangle", { north: 32.5, south: 32.49, east: 74.53, west: 74.52 });
    expect(built.center_lat).toBeCloseTo(32.495, 6);
    expect(built.center_lng).toBeCloseTo(74.525, 6);
  });

  it("derives a route's distance and duration instead of trusting the client", () => {
    const built = buildGeometry("route", {
      origin: { lat: 32.49, lng: 74.52 },
      destination: { lat: 32.5, lng: 74.52 },
      waypoints: [],
      buffer_m: 60,
      travel_mode: "Driving",
    });

    expect(built.distance_km).toBeGreaterThan(1.1);
    expect(built.duration_min).toBeGreaterThan(0);
    expect(built.buffer_m).toBe(60);
  });

  it("floors an unusably thin route corridor", () => {
    const built = buildGeometry("route", {
      origin: OFFICE,
      destination: OFFICE,
      buffer_m: 1,
    });
    expect(built.buffer_m).toBe(10);
  });

  it("rejects an unknown fence type", () => {
    expect(() => buildGeometry("hexagon", {})).toThrow(TypeError);
  });
});

describe("fenceVertices and bounds", () => {
  it("reads a point back as one vertex", () => {
    const fence = { type: "circle", geometry: circleGeometry(CIRCLE), radius_m: 200 };
    expect(fenceVertices(fence)).toEqual([{ lat: OFFICE.lat, lng: OFFICE.lng }]);
  });

  it("pads a circle's bounds by its radius", () => {
    const fence = { type: "circle", geometry: circleGeometry(CIRCLE), radius_m: 1113 };
    const [[south, west], [north, east]] = fenceBounds(fence);
    expect(north - OFFICE.lat).toBeCloseTo(0.01, 3);
    expect(OFFICE.lat - south).toBeCloseTo(0.01, 3);
    expect(west).toBeLessThan(OFFICE.lng);
    expect(east).toBeGreaterThan(OFFICE.lng);
  });

  it("fits a polygon exactly", () => {
    const fence = {
      type: "polygon",
      geometry: rectangleGeometry({ north: 32.5, south: 32.49, east: 74.53, west: 74.52 }),
    };
    expect(fenceBounds(fence)).toEqual([
      [32.49, 74.52],
      [32.5, 74.53],
    ]);
  });

  it("returns null rather than jumping the map when there is nothing to fit", () => {
    expect(fenceBounds({ type: "polygon" })).toBeNull();
    expect(fenceBounds({ type: "polygon", geometry: { type: "Polygon" } })).toBeNull();
  });

  it("prefers a stored centre for the label anchor", () => {
    const fence = { center_lat: 1, center_lng: 2, geometry: circleGeometry(CIRCLE) };
    expect(fenceCenter(fence)).toEqual({ lat: 1, lng: 2 });
  });

  it("falls back to the vertex average for a route", () => {
    const fence = {
      type: "route",
      geometry: {
        type: "LineString",
        coordinates: [
          [74.52, 32.49],
          [74.54, 32.51],
        ],
      },
    };
    expect(fenceCenter(fence)).toEqual({ lat: 32.5, lng: 74.53 });
  });
});

describe("geofenceSchema", () => {
  const common = { name: "Head Office", color: "#2563eb" };

  it("accepts a circle", () => {
    const parsed = geofenceSchema.parse({
      ...common,
      type: "circle",
      center_lat: OFFICE.lat,
      center_lng: OFFICE.lng,
      radius_m: 250,
    });
    expect(parsed.status).toBe("active");
    expect(parsed.buffer_m).toBe(0);
  });

  it("rejects an out-of-range coordinate", () => {
    const result = geofenceSchema.safeParse({
      ...common,
      type: "circle",
      center_lat: 99,
      center_lng: OFFICE.lng,
      radius_m: 250,
    });
    expect(result.success).toBe(false);
  });

  it("rejects a malformed colour", () => {
    const result = geofenceSchema.safeParse({
      ...common,
      color: "blue",
      type: "circle",
      center_lat: OFFICE.lat,
      center_lng: OFFICE.lng,
      radius_m: 250,
    });
    expect(result.success).toBe(false);
  });

  it("requires three points for a polygon", () => {
    const result = geofenceSchema.safeParse({
      ...common,
      type: "polygon",
      points: [OFFICE, OFFICE],
    });
    expect(result.success).toBe(false);
  });

  it("requires both ends of a route", () => {
    const result = geofenceSchema.safeParse({ ...common, type: "route", origin: OFFICE });
    expect(result.success).toBe(false);
  });

  it("rejects a buffer on a route wider than the cap", () => {
    const result = geofenceSchema.safeParse({
      ...common,
      type: "route",
      origin: OFFICE,
      destination: OFFICE,
      buffer_m: 999999,
    });
    expect(result.success).toBe(false);
  });

  it("rejects a payload with no recognisable type", () => {
    expect(geofenceSchema.safeParse({ ...common, type: "hexagon" }).success).toBe(false);
  });
});

describe("toGeofenceRow", () => {
  const circle = {
    name: "Office",
    type: "circle",
    center_lat: OFFICE.lat,
    center_lng: OFFICE.lng,
    radius_m: 250,
    buffer_m: 0,
    color: "#2563eb",
    status: "active",
  };

  it("never carries the draw-only fields into the database", () => {
    const row = toGeofenceRow(circle);
    expect(row.center_lat).toBe(OFFICE.lat);
    expect(row.geometry).toEqual({ type: "Point", coordinates: [74.5229, 32.4945] });
    expect(row.points).toBeUndefined();
  });

  it("clears the columns a different fence type would have used", () => {
    const row = toGeofenceRow({
      name: "Route",
      type: "route",
      origin: OFFICE,
      destination: { lat: 32.5, lng: 74.52 },
      waypoints: [],
      buffer_m: 50,
      travel_mode: "Driving",
    });
    // A circle's radius must not survive into a route.
    expect(row.radius_m).toBeNull();
    expect(row.distance_km).toBeGreaterThan(0);
    expect(row.duration_min).toBeGreaterThan(0);
  });

  it("does not accept a client-supplied derived value", () => {
    const row = toGeofenceRow({
      ...circle,
      id: "11111111-1111-1111-1111-111111111111",
      company_id: "22222222-2222-2222-2222-222222222222",
      created_by: "33333333-3333-3333-3333-333333333333",
      distance_km: 999,
    });

    expect(row.id).toBeUndefined();
    expect(row.company_id).toBeUndefined();
    expect(row.created_by).toBeUndefined();
    expect(row.distance_km).not.toBe(999);
  });
});