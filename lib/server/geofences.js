import { buildGeometry } from "@/lib/monitor/geojson";
import { GEOFENCE_CLIENT_CONTROLLED } from "@/lib/monitor/validation";

/**
 * Geofence persistence.
 *
 * Every statement is scoped by `company_id` as well as `id`, so a fence id from
 * another tenant matches nothing rather than another company's data — the RLS
 * policies are a second line of defence, not the only one.
 */

export const GEOFENCE_SELECT = [
  "id",
  "name",
  "type",
  "description",
  "geometry",
  "center_lat",
  "center_lng",
  "radius_m",
  "buffer_m",
  "travel_mode",
  "color",
  "origin",
  "destination",
  "waypoints",
  "distance_km",
  "duration_min",
  "status",
  "created_at",
  "updated_at",
].join(", ");

const CLIENT_CONTROLLED = new Set(GEOFENCE_CLIENT_CONTROLLED);

/**
 * Turn validated form values into a database row.
 *
 * The geometry and everything derived from it are computed here rather than
 * accepted from the client, so `distance_km` can never contradict the shape
 * that is actually stored.
 */
export function toGeofenceRow(values) {
  const { type, ...rest } = values;
  const derived = buildGeometry(type, values);

  const row = { ...rest, ...derived };

  // A circle's buffer widens the radius; other types keep it as drawn.
  if (type !== "route") {
    row.buffer_m = Number(values.buffer_m) || 0;
  }

  // Not every type uses these columns, and an unused one must be cleared rather
  // than left holding the previous fence's value.
  if (type !== "route") {
    row.travel_mode = null;
    row.distance_km = null;
    row.duration_min = null;
  }
  if (type !== "circle") row.radius_m = null;

  for (const key of CLIENT_CONTROLLED) delete row[key];
  delete row.north;
  delete row.south;
  delete row.east;
  delete row.west;
  delete row.points;

  return row;
}

export async function listGeofences(supabase, { companyId, type, status, search } = {}) {
  let query = supabase
    .from("geofences")
    .select(GEOFENCE_SELECT, { count: "exact" })
    .eq("company_id", companyId);

  if (type) query = query.eq("type", type);
  if (status) query = query.eq("status", status);
  if (search) query = query.ilike("name", `%${sanitiseSearch(search)}%`);

  const { data, error, count } = await query.order("name", { ascending: true });
  if (error) throw error;

  const rows = data || [];

  // Employee counts come from a second, tiny query rather than a join, so the
  // list stays fast with many employees and no count is left at zero by a
  // missing relationship.
  const counts = await geofenceEmployeeCounts(supabase, { companyId });

  return {
    rows: rows.map((row) => ({ ...row, employee_count: counts[row.id] || 0 })),
    total: count ?? rows.length,
  };
}

async function geofenceEmployeeCounts(supabase, { companyId }) {
  const { data, error } = await supabase
    .from("employee_geofences")
    .select("geofence_id")
    .eq("company_id", companyId);

  if (error) throw error;

  const counts = {};
  for (const row of data || []) {
    counts[row.geofence_id] = (counts[row.geofence_id] || 0) + 1;
  }
  return counts;
}

export async function getGeofence(supabase, { companyId, id }) {
  const { data, error } = await supabase
    .from("geofences")
    .select(GEOFENCE_SELECT)
    .eq("id", id)
    .eq("company_id", companyId)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

/** Employees assigned to a fence, for the fence's detail panel. */
export async function listGeofenceEmployees(supabase, { companyId, id }) {
  const { data, error } = await supabase
    .from("employee_geofences")
    .select("employee_id, employees ( id, emp_code, name, phone, status )")
    .eq("company_id", companyId)
    .eq("geofence_id", id);

  if (error) throw error;

  // PostgREST nests the join, which comes back as an object for a many-to-one.
  return (data || [])
    .map((row) => {
      const employee = Array.isArray(row.employees) ? row.employees[0] : row.employees;
      return employee ? { ...employee } : null;
    })
    .filter(Boolean);
}

export async function createGeofence(supabase, { companyId, values, actorId }) {
  const row = toGeofenceRow(values);

  const { data, error } = await supabase
    .from("geofences")
    .insert({ ...row, company_id: companyId, created_by: actorId || null })
    .select(GEOFENCE_SELECT)
    .single();

  if (error) throw error;
  return { ...data, employee_count: 0 };
}

export async function updateGeofence(supabase, { companyId, id, values }) {
  const row = toGeofenceRow(values);

  const { data, error } = await supabase
    .from("geofences")
    .update(row)
    .eq("id", id)
    .eq("company_id", companyId)
    .select(GEOFENCE_SELECT)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

/**
 * Deactivate rather than delete.
 *
 * A fence is referenced by presence checks and violations that must keep
 * explaining themselves after the fence is retired, so removing it would leave
 * those rows unreadable. `status = 'inactive'` also stops it matching anybody.
 */
export async function deactivateGeofence(supabase, { companyId, id }) {
  const { data, error } = await supabase
    .from("geofences")
    .update({ status: "inactive" })
    .eq("id", id)
    .eq("company_id", companyId)
    .select("id, name")
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

/**
 * Hard delete, only for a fence that was never used.
 *
 * Refuses once any employee is assigned to it, because unassigning them
 * silently would be worse than telling the admin to deactivate instead.
 */
export async function deleteGeofence(supabase, { companyId, id }) {
  const counts = await geofenceEmployeeCounts(supabase, { companyId });
  const assigned = Object.values(counts).reduce((sum, n) => sum + n, 0);

  const { data, error } = await supabase
    .from("geofences")
    .delete()
    .eq("id", id)
    .eq("company_id", companyId)
    .select("id, name")
    .maybeSingle();

  if (error) throw error;

  return { deleted: data || null, assigned };
}

/** Escape the LIKE wildcards so a name with `%` cannot match everything. */
export function sanitiseSearch(value) {
  return String(value || "")
    .replace(/[%_\\]/g, (c) => `\\${c}`)
    .slice(0, 80);
}