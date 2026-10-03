/**
 * Geofence geometry evaluation.
 *
 * All four fence types reduce to one question: is this point inside the fence?
 *   circle     -> great-circle distance from centre <= radius
 *   polygon    -> ray-casting point-in-polygon
 *   rectangle  -> a polygon, so the same ray-cast path
 *   route      -> distance to the polyline <= buffer (a corridor)
 *
 * Geometry is GeoJSON. Longitudes are handled across the antimeridian because
 * a route between Sialkot and Lahore does not cross it, but the maths should
 * not silently break if one ever does.
 *
 * Pure functions, no database access — this module is unit tested directly.
 */

const EARTH_RADIUS_M = 6371000;

const toRad = (deg) => (Number(deg) * Math.PI) / 180;
const toDeg = (rad) => (rad * 180) / Math.PI;

/** Great-circle distance in metres. Mirrors lib/utils.js haversine. */
export function haversineMeters(lat1, lng1, lat2, lng2) {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(Math.min(1, a)));
}

/** Shortest signed longitude delta, so 359deg -> 1deg is +2 not -358. */
function lngDelta(a, b) {
  let d = b - a;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
}

/** Local flat-earth projection in metres around an origin. Good at city scale. */
function project(point, origin) {
  const x = toRad(lngDelta(origin.lng, point.lng)) * EARTH_RADIUS_M * Math.cos(toRad(origin.lat));
  const y = toRad(point.lat - origin.lat) * EARTH_RADIUS_M;
  return [x, y];
}

export function normalizeLng(lng) {
  return ((((Number(lng) + 180) % 360) + 360) % 360) - 180;
}

/**
 * Distance in metres from a point to a line segment, using a local planar
 * projection anchored at the point. Accurate to well under a metre at the
 * scale of a single route segment.
 */
export function distanceToSegmentMeters(point, a, b) {
  const origin = point;
  const [px, py] = project(point, origin);
  const [ax, ay] = project(a, origin);
  const [bx, by] = project(b, origin);

  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;

  if (lenSq === 0) return Math.hypot(px - ax, py - ay);

  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));

  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Shortest distance in metres from a point to a polyline. */
export function distanceToPolylineMeters(point, line) {
  if (!Array.isArray(line) || line.length === 0) return Infinity;
  if (line.length === 1) return haversineMeters(point.lat, point.lng, line[0][1], line[0][0]);

  let best = Infinity;
  for (let i = 0; i < line.length - 1; i++) {
    const a = { lat: line[i][1], lng: line[i][0] };
    const b = { lat: line[i + 1][1], lng: line[i + 1][0] };
    best = Math.min(best, distanceToSegmentMeters(point, a, b));
  }
  return best;
}

/** Total length of a [[lng,lat], ...] polyline, in metres. */
export function lineLengthMeters(line) {
  if (!Array.isArray(line)) return 0;
  let total = 0;
  for (let i = 0; i < line.length - 1; i++) {
    total += haversineMeters(
      line[i][1], line[i][0],
      line[i + 1][1], line[i + 1][0]
    );
  }
  return total;
}

/** Close a ring by repeating the first coordinate, as GeoJSON requires. */
export function closeRing(ring) {
  if (!ring || ring.length === 0) return ring;
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] === last[0] && first[1] === last[1]) return ring;
  return [...ring, [...first]];
}

/**
 * Ray-casting point-in-polygon.
 * `ring` is [[lng,lat], ...]; a hole is passed in `holes`.
 * Boundary points count as inside, which matters when a phone reports a fix
 * exactly on a fence edge.
 */
export function pointInPolygon(point, ring, holes = []) {
  if (!Array.isArray(ring) || ring.length < 3) return false;

  const { x, y } = toLngLat(point);
  if (pointOnRingBoundary({ lng: x, lat: y }, ring)) return true;

  if (!rayCast({ x, y }, ring)) return false;

  for (const hole of holes || []) {
    if (rayCast({ x, y }, hole)) return false;
  }
  return true;
}

function toLngLat(point) {
  if (Array.isArray(point)) return { x: Number(point[0]), y: Number(point[1]) };
  return { x: Number(point.lng), y: Number(point.lat) };
}

function rayCast({ x, y }, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersects = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function pointOnRingBoundary(point, ring) {
  const tolerance = 1e-9;
  for (let i = 0, iMax = ring.length - 1; i < iMax; i++) {
    const a = { lat: ring[i][1], lng: ring[i][0] };
    const b = { lat: ring[i + 1][1], lng: ring[i + 1][0] };
    if (distanceToSegmentMeters(point, a, b) < 0.5) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// GeoJSON normalisation
// ---------------------------------------------------------------------------

/** Extract [[lng,lat], ...] from a Point / MultiPoint / LineString / Polygon. */
export function geometryToCoords(geometry) {
  if (!geometry) return null;

  // A bare Feature/FeatureCollection wrapper.
  if (geometry.type === "Feature") return geometryToCoords(geometry.geometry);
  if (geometry.type === "FeatureCollection") {
    return geometry.features?.length
      ? geometryToCoords(geometry.features[0].geometry)
      : null;
  }
  if (geometry.type === "GeometryCollection") {
    const first = geometry.geometries?.find((g) =>
      ["Point", "MultiPoint", "LineString", "Polygon", "MultiLineString"].includes(g?.type)
    );
    return first ? geometryToCoords(first) : null;
  }

  switch (geometry.type) {
    case "Point":
      return [[geometry.coordinates[0], geometry.coordinates[1]]];
    case "MultiPoint":
    case "LineString":
      return geometry.coordinates;
    case "MultiLineString":
      return geometry.coordinates.flat();
    case "Polygon":
      return geometry.coordinates[0];
    case "MultiPolygon":
      return geometry.coordinates[0][0];
    default:
      return null;
  }
}

/** Outer ring of a polygon/multi-polygon, closed. */
export function polygonRing(geometry) {
  if (!geometry) return null;
  if (geometry.type === "Feature") return polygonRing(geometry.geometry);
  if (geometry.type === "Polygon") return closeRing(geometry.coordinates[0]);
  if (geometry.type === "MultiPolygon") return closeRing(geometry.coordinates[0][0]);
  if (geometry.type === "GeometryCollection") {
    const poly = geometry.geometries?.find((g) => g?.type === "Polygon" || g?.type === "MultiPolygon");
    return poly ? polygonRing(poly) : null;
  }
  return null;
}

export function polygonHoles(geometry) {
  if (!geometry || geometry.type === "Feature") return [];
  if (geometry.type === "Polygon") return (geometry.coordinates || []).slice(1);
  if (geometry.type === "MultiPolygon") return (geometry.coordinates?.[0] || []).slice(1);
  return [];
}

/** Rectangle from two opposite corners. */
export function rectanglePolygon(sw, ne) {
  return closeRing([
    [sw.lng, sw.lat],
    [ne.lng, sw.lat],
    [ne.lng, ne.lat],
    [sw.lng, ne.lat],
  ]);
}

export function centroid(coords) {
  if (!coords || coords.length === 0) return null;
  const sum = coords.reduce(
    (acc, c) => ({ lat: acc.lat + c[1] / coords.length, lng: acc.lng + c[0] / coords.length }),
    { lat: 0, lng: 0 }
  );
  return sum;
}

// ---------------------------------------------------------------------------
// The fence evaluation entry point
// ---------------------------------------------------------------------------

/**
 * @returns {{ inside: boolean, distance_m: number|null, fence_id?: string,
 *             fence_name?: string, fence_type?: string }}
 */
export function evaluateFence(fence, point) {
  if (!fence || !point) return { inside: false, distance_m: null };

  const type = fence.type;
  const geometry = fence.geometry;

  if (type === "circle") {
    const center = fence.center_lat != null
      ? { lat: Number(fence.center_lat), lng: Number(fence.center_lng) }
      : (() => {
          const c = geometryToCoords(geometry)?.[0];
          return c ? { lat: c[1], lng: c[0] } : null;
        })();
    if (!center) return { inside: false, distance_m: null };

    const radius = Number(fence.radius_m ?? 0);
    const distance = haversineMeters(center.lat, center.lng, point.lat, point.lng);
    return {
      inside: distance <= radius,
      distance_m: Math.round(distance),
      ...describe(fence),
    };
  }

  if (type === "polygon" || type === "rectangle") {
    const ring = polygonRing(geometry);
    if (!ring) return { inside: false, distance_m: null };
    const holes = polygonHoles(geometry);
    return {
      inside: pointInPolygon(point, ring, holes),
      distance_m: null,
      ...describe(fence),
    };
  }

  if (type === "route") {
    const line = geometryToCoords(geometry);
    if (!line || line.length < 2) return { inside: false, distance_m: null };
    const buffer = Number(fence.buffer_m ?? 50);
    const distance = distanceToPolylineMeters(point, line);
    return {
      inside: distance <= buffer,
      distance_m: Math.round(distance),
      ...describe(fence),
    };
  }

  return { inside: false, distance_m: null };
}

function describe(fence) {
  return {
    fence_id: fence.id,
    fence_name: fence.name,
    fence_type: fence.type,
  };
}

/**
 * Evaluate a point against a list of fences.
 *
 * When `assignedIds` is provided only those fences are considered — that is
 * what an employee's "Assigned Locations" mean. Otherwise every active fence
 * for the company is in play.
 */
export function evaluateFences(fences, point, assignedIds = null) {
  // Callers pass raw rows, so archived fences must be dropped here rather
  // than trusting every call site to remember `status = 'active'`.
  const active = fences.filter((f) => f.status == null || f.status === "active");

  const pool = assignedIds
    ? active.filter((f) => assignedIds.includes(f.id))
    : active;

  const matches = [];
  for (const fence of pool) {
    const result = evaluateFence(fence, point);
    if (result.inside) matches.push(result);
  }

  return {
    inside: matches.length > 0,
    matches,
    // Nearest fence, so "you are 120 m outside the Sialkot office circle"
    // can be reported even when the answer is "outside".
    nearest: nearestFence(pool, point),
  };
}

export function nearestFence(fences, point) {
  let best = null;
  for (const fence of fences) {
    const r = evaluateFence(fence, point);
    if (r.distance_m == null) {
      // Polygon / rectangle: measure to the edge rather than skipping.
      const ring = polygonRing(fence.geometry);
      const edge = ring ? distanceToPolylineMeters(point, ring) : Infinity;
      if (!best || edge < best.distance_m) {
        best = { ...describe(fence), distance_m: Math.round(edge), inside: false };
      }
    } else if (!best || r.distance_m < best.distance_m) {
      best = r;
    }
  }
  return best;
}