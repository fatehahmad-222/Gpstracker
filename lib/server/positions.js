import { evaluateFences } from "@/lib/monitor/geofence";

/**
 * Latest employee positions for the live map.
 *
 * Reads the `employee_positions` projection, never the history table: the map
 * asks "where is everyone now" once every few seconds and must not turn that
 * into a full scan of `device_events`.
 */

/** A fix older than this is shown as stale rather than as a live position. */
export const STALE_AFTER_MS = 5 * 60 * 1000;
/** Beyond this, the position is not worth drawing at all. */
export const DROP_AFTER_MS = 60 * 60 * 1000;

/**
 * Staleness buckets, newest first.
 *
 * "Never" is separate from "stale" on purpose: an employee who has never
 * reported is a different problem from one whose phone died, and conflating
 * them hides a real fault.
 */
export function freshness(ageMs) {
  if (ageMs == null) return "never";
  if (ageMs <= STALE_AFTER_MS) return "live";
  if (ageMs <= DROP_AFTER_MS) return "stale";
  return "gone";
}

export async function listPositions(supabase, { companyId, departmentId } = {}) {
  let query = supabase
    .from("employee_positions")
    .select(
      "employee_id, lat, lng, accuracy, speed, heading, battery, recorded_at, employees ( id, emp_code, name, phone, department_id, shift_start, shift_end, overnight_allowed, status, deleted_at )"
    )
    .eq("company_id", companyId);

  if (departmentId) {
    // Filtering on the embedded relation keeps it to one round trip; the
    // `!inner` hint makes PostgREST drop employees that have no position row.
    query = query.eq("employees.department_id", departmentId);
  }

  const { data, error } = await query;
  if (error) throw error;

  return (data || []).map((row) => {
    const employee = Array.isArray(row.employees) ? row.employees[0] : row.employees;
    if (!employee) return null;

    const ageMs = row.recorded_at ? Date.now() - new Date(row.recorded_at).getTime() : null;

    return {
      employee_id: row.employee_id,
      emp_code: employee.emp_code,
      name: employee.name,
      department_id: employee.department_id,
      lat: row.lat,
      lng: row.lng,
      accuracy: row.accuracy,
      speed: row.speed,
      heading: row.heading,
      battery: row.battery,
      recorded_at: row.recorded_at,
      age_ms: ageMs,
      freshness: freshness(ageMs),
      archived: Boolean(employee.deleted_at),
    };
  }).filter(Boolean);
}

/**
 * Annotate positions with whether each person is inside one of their assigned
 * fences.
 *
 * Done on the server so every client agrees on the answer, and done against the
 * employee's *assigned* fences only — matching everybody against the whole
 * estate would flag a site visit as an out-of-fence excursion.
 */
export async function annotateWithFences(supabase, { companyId, positions }) {
  if (!positions.length) return positions;

  const { data: links, error } = await supabase
    .from("employee_geofences")
    .select("employee_id, geofences ( id, name, type, geometry, center_lat, center_lng, radius_m, buffer_m, status )")
    .eq("company_id", companyId);

  if (error) throw error;

  const byEmployee = new Map();
  for (const link of links || []) {
    const fence = Array.isArray(link.geofences) ? link.geofences[0] : link.geofences;
    if (!fence || fence.status !== "active") continue;
    if (!byEmployee.has(link.employee_id)) byEmployee.set(link.employee_id, []);
    byEmployee.get(link.employee_id).push(fence);
  }

  return positions.map((position) => {
    const assigned = byEmployee.get(position.employee_id) || [];

    if (!assigned.length) {
      return { ...position, inside_fence: null, inside_fence_ids: [], inside_fence_names: [] };
    }

    const result = evaluateFences(assigned, { lat: position.lat, lng: position.lng });

    return {
      ...position,
      inside_fence: result.inside,
      inside_fence_ids: result.matches.map((m) => m.fence_id),
      // `fence_name`, not `name`: matches describe the fence rather than
      // replacing it, so the identifier is prefixed.
      inside_fence_names: result.matches.map((m) => m.fence_name).filter(Boolean),
    };
  });
}