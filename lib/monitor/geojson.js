import { haversineMeters, rectanglePolygon } from "@/lib/monitor/geofence";

/**
 * GeoJSON builders for geofences.
 *
 * One table stores four fence types, so the geometry column is always GeoJSON
 * and these functions are the single place that decides what each type looks
 * like. Keeping them pure means the map editor and the API route cannot drift
 * apart: both call `buildGeometry` with the same form values.
 *
 * GeoJSON order is [longitude, latitude] — the reverse of how humans read a
 * coordinate pair — and rings must repeat their first point to close.
 */

const coord = (point) => [
  Number(point.lng),
  Number(point.lat),
];

function assertFinite(...values) {
  if (values.some((v) => !Number.isFinite(Number(v)))) {
    throw new TypeError("A fence coordinate was not a finite number");
  }
}

/** circle -> Point at the centre. The radius lives in `radius_m`. */
export function circleGeometry({ center_lat, center_lng }) {
  assertFinite(center_lat, center_lng);
  return { type: "Point", coordinates: [Number(center_lng), Number(center_lat)] };
}

/**
 * rectangle -> Polygon from two opposite corners.
 *
 * The drag gesture gives two arbitrary corners, so the ring is built in
 * min/max order; otherwise dragging bottom-right to top-left would produce a
 * self-intersecting ring that renders as a bow tie.
 */
export function rectangleGeometry({ north, south, east, west }) {
  assertFinite(north, south, east, west);
  const nw = { lat: Math.max(north, south), lng: Math.min(east, west) };
  const se = { lat: Math.min(north, south), lng: Math.max(east, west) };
  return { type: "Polygon", coordinates: [rectanglePolygon(nw, se)] };
}

/** polygon -> Polygon from the drawn vertices, with the ring closed. */
export function polygonGeometry(points) {
  const ring = points.map(coord);
  if (ring.length < 3) throw new TypeError("A polygon needs at least 3 points");

  const [first] = ring;
  const last = ring[ring.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) ring.push([...first]);

  return { type: "Polygon", coordinates: [ring] };
}

/**
 * route -> LineString through origin, waypoints and destination.
 *
 * The order is fixed rather than sorted, because a route is a direction of
 * travel: origin first, destination last.
 */
export function routeGeometry({ origin, waypoints = [], destination }) {
  const points = [origin, ...waypoints, destination].filter(Boolean);
  if (points.length < 2) throw new TypeError("A route needs an origin and a destination");

  return { type: "LineString", coordinates: points.map(coord) };
}

/**
 * Geometry for any fence type.
 *
 * Returns `{ geometry, ...derived }` because the route columns (distance_km,
 * duration_min) and the circle centre are derived from the shape rather than
 * typed in, so they cannot disagree with what is drawn.
 */
export function buildGeometry(type, input) {
  switch (type) {
    case "circle": {
      const { center_lat, center_lng, radius_m: radius } = input;
      if (!Number.isFinite(Number(radius)) || Number(radius) <= 0) {
        throw new TypeError("A circle needs a radius greater than zero");
      }
      return {
        geometry: circleGeometry(input),
        center_lat: Number(center_lat),
        center_lng: Number(center_lng),
        radius_m: Number(radius),
        waypoints: [],
      };
    }

    case "rectangle":
      return {
        geometry: rectangleGeometry(input),
        // Kept for the map's "zoom to fence" and for a quick label.
        center_lat: (Number(input.north) + Number(input.south)) / 2,
        center_lng: (Number(input.east) + Number(input.west)) / 2,
        radius_m: null,
        waypoints: [],
      };

    case "polygon":
      return { geometry: polygonGeometry(input.points || []), waypoints: [] };

    case "route": {
      const geometry = routeGeometry(input);
      const points = (input.origin ? [input.origin] : [])
        .concat(input.waypoints || [], input.destination ? [input.destination] : [])
        .filter(Boolean);

      const distanceKm = polylineLengthKm(geometry.coordinates);
      const { buffer_m: bufferM = 50, travel_mode: mode = "Driving" } = input;

      return {
        geometry,
        center_lat: null,
        center_lng: null,
        radius_m: null,
        origin: input.origin ? { lat: Number(input.origin.lat), lng: Number(input.origin.lng) } : null,
        destination: input.destination
          ? { lat: Number(input.destination.lat), lng: Number(input.destination.lng) }
          : null,
        waypoints: (input.waypoints || []).map((p) => ({ lat: Number(p.lat), lng: Number(p.lng) })),
        distance_km: distanceKm,
        // A deliberately rough planning figure, clearly labelled as such in the
        // UI. It is only used to flag an impossible route, never for billing.
        duration_min: estimateMinutes(distanceKm, mode),
        // A corridor has to be wide enough to be useful on the ground.
        buffer_m: Math.max(Number(bufferM) || 0, 10),
      };
    }

    default:
      throw new TypeError(`Unknown fence type: ${type}`);
  }
}

/** Great-circle length of a [lng, lat] polyline, in kilometres. */
export function polylineLengthKm(coordinates) {
  let meters = 0;
  for (let i = 1; i < coordinates.length; i += 1) {
    const [lng1, lat1] = coordinates[i - 1];
    const [lng2, lat2] = coordinates[i];
    meters += haversineMeters(lat1, lng1, lat2, lng2);
  }
  return Math.round((meters / 1000) * 100) / 100;
}

// Rough urban averages in km/h. Deliberately coarse — see the note above.
const SPEEDS = { Driving: 32, Walking: 4.8, Cycling: 14, Transit: 22 };

export function estimateMinutes(distanceKm, mode) {
  const speed = SPEEDS[mode] || SPEEDS.Driving;
  if (!distanceKm) return 0;
  return Math.max(1, Math.round((distanceKm / speed) * 60));
}

/** Every vertex of a fence, whatever its type. Used for bounds and drawing. */
export function fenceVertices(fence) {
  const geometry = fence.geometry || {};
  const coords = Array.isArray(geometry.coordinates) ? geometry.coordinates : [];

  if (geometry.type === "Point" && coords.length >= 2) {
    return [{ lat: coords[1], lng: coords[0] }];
  }
  if (geometry.type === "LineString") {
    return coords
      .filter((c) => Array.isArray(c) && c.length >= 2)
      .map(([lng, lat]) => ({ lat, lng }));
  }
  if (geometry.type === "Polygon") {
    return (coords[0] || [])
      .filter((c) => Array.isArray(c) && c.length >= 2)
      .map(([lng, lat]) => ({ lat, lng }));
  }
  return [];
}

/**
 * Leaflet `bounds` for a fence: [[south, west], [north, east]].
 *
 * Returns null when there is nothing to fit, so the caller can leave the map
 * where it is instead of jumping to null island.
 */
export function fenceBounds(fence) {
  const points = fenceVertices(fence);
  if (fence.type === "circle" && points.length) {
    const { lat, lng } = points[0];
    // Latitude degrees are ~111 m; longitude shrinks with cos(lat).
    const dLat = Number(fence.radius_m || 0) / 111320;
    const dLng = dLat / Math.max(0.01, Math.cos((lat * Math.PI) / 180));
    return [
      [lat - dLat, lng - dLng],
      [lat + dLat, lng + dLng],
    ];
  }

  if (!points.length) return null;

  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);
  return [
    [Math.min(...lats), Math.min(...lngs)],
    [Math.max(...lats), Math.max(...lngs)],
  ];
}

/**
 * The fence's nominal centre, for placing a label on the map.
 * Prefers the stored centre, then the polygon centroid, then the first vertex.
 */
export function fenceCenter(fence) {
  if (Number.isFinite(Number(fence.center_lat)) && Number.isFinite(Number(fence.center_lng))) {
    return { lat: Number(fence.center_lat), lng: Number(fence.center_lng) };
  }
  const points = fenceVertices(fence);
  if (!points.length) return null;
  return {
    lat: points.reduce((sum, p) => sum + p.lat, 0) / points.length,
    lng: points.reduce((sum, p) => sum + p.lng, 0) / points.length,
  };
}