"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { AlertTriangle, Loader2, MapPin, Undo2 } from "lucide-react";

import { Card } from "@/components/monitor/primitives";
import { Field, inputClass } from "@/components/monitor/config/fields";
import { api, ApiError } from "@/lib/monitor/client";
import { buildGeometry } from "@/lib/monitor/geojson";
import { FENCE_TYPES, TRAVEL_MODES } from "@/lib/monitor/validation";
import { cn } from "@/lib/utils";

const FenceMap = dynamic(() => import("./FenceMap"), {
  ssr: false,
  loading: () => (
    <div className="flex h-[420px] items-center justify-center rounded-tile border border-line bg-surface-2 text-[12.5px] text-ink-dim">
      Loading map…
    </div>
  ),
});

const TYPE_LABELS = {
  circle: "Circle (radius)",
  polygon: "Polygon (draw area)",
  rectangle: "Rectangle (drag box)",
  route: "Route (corridor)",
};

const TYPE_HINTS = {
  circle: "One click sets the centre, then set the radius in metres.",
  polygon: "Click each corner of the area. At least 3 points.",
  rectangle: "Click one corner, then the opposite corner.",
  route: "Click the origin, any waypoints, then the destination.",
};

const PRESET_COLORS = ["#2563eb", "#16a34a", "#ea580c", "#dc2626", "#7c3aed", "#0891b2"];

const BLANK = {
  name: "",
  description: "",
  type: "circle",
  color: "#2563eb",
  status: "active",
  center_lat: "",
  center_lng: "",
  radius_m: 150,
  buffer_m: 0,
  north: "",
  south: "",
  east: "",
  west: "",
  points: [],
  origin: null,
  destination: null,
  waypoints: [],
  travel_mode: "Driving",
};

/**
 * Geofence editor.
 *
 * The map is the primary input: a click produces the coordinates and the
 * numeric fields follow, rather than the admin typing latitude and longitude.
 * Numeric entry is still possible for a centre and a radius, which is what
 * someone copying a fence from a survey report needs.
 */
export function FenceForm({ fence, onCancel, onSaved }) {
  const isEdit = Boolean(fence?.id);
  const [values, setValues] = useState(() => (fence ? fromFenceRow(fence) : BLANK));
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [drawing, setDrawing] = useState(false);

  const type = values.type;

  const set = (key) => (event) => {
    const raw = event?.target ? event.target.value : event;
    setValues((v) => ({ ...v, [key]: raw }));
    setErrors((prev) => (prev[key] ? { ...prev, [key]: undefined } : prev));
  };

  /**
   * The shape as it would be saved, built by the same function the server uses.
   * A shape that cannot be built yet simply draws nothing, rather than throwing
   * mid-click.
   */
  const draft = useMemo(() => {
    try {
      const built = buildGeometry(type, {
        ...values,
        points: values.points.map((p) => ({ lat: p.lat, lng: p.lng })),
        waypoints: (values.waypoints || []).map((p) => ({ lat: p.lat, lng: p.lng })),
      });
      return { ...values, ...built };
    } catch {
      return null;
    }
  }, [values, type]);

  const vertices = values.points?.length || 0;
  const routePoints = (values.origin ? 1 : 0) + (values.waypoints?.length || 0) + (values.destination ? 1 : 0);

  /** One map click, interpreted per fence type. */
  function onPick(point) {
    setErrors((prev) => ({ ...prev, _shape: undefined }));

    if (type === "circle") {
      setValues((v) => ({ ...v, center_lat: point.lat, center_lng: point.lng }));
      return;
    }

    if (type === "rectangle") {
      // First click is one corner, the second is the opposite one. The first
      // corner has to be remembered or the box collapses to a point.
      if (!values.north || !values.west) {
        setValues((v) => ({ ...v, north: point.lat, south: point.lat, east: point.lng, west: point.lng }));
      } else {
        setValues((v) => ({
          ...v,
          north: Math.max(Number(v.north), point.lat),
          south: Math.min(Number(v.south), point.lat),
          east: Math.max(Number(v.east), point.lng),
          west: Math.min(Number(v.west), point.lng),
        }));
      }
      return;
    }

    if (type === "polygon") {
      setValues((v) => ({ ...v, points: [...(v.points || []), point] }));
      return;
    }

    // route: the first click is the origin, and the click after the
    // destination promotes the previous vertex to a waypoint.
    if (!values.origin) {
      setValues((v) => ({ ...v, origin: point, destination: null, waypoints: [] }));
      return;
    }
    setValues((v) => {
      if (!v.destination) return { ...v, destination: point };
      return { ...v, waypoints: [...(v.waypoints || []), v.destination], destination: point };
    });
  }

  function undo() {
    setValues((v) => {
      if (type === "rectangle") return { ...v, north: "", south: "", east: "", west: "" };
      if (type === "polygon") return { ...v, points: (v.points || []).slice(0, -1) };
      if (type === "route") {
        if (v.destination) return { ...v, destination: null };
        if (v.waypoints?.length) return { ...v, waypoints: v.waypoints.slice(0, -1) };
        return { ...v, origin: null };
      }
      return { ...v, center_lat: "", center_lng: "" };
    });
  }

  function clearShape() {
    setValues((v) => ({
      ...v,
      center_lat: "",
      center_lng: "",
      north: "",
      south: "",
      east: "",
      west: "",
      points: [],
      origin: null,
      destination: null,
      waypoints: [],
    }));
  }

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setErrors({});

    try {
      if (isEdit) {
        await api.patch(`/api/monitor/geofences/${fence.id}`, buildPayload(values));
        onSaved(`"${values.name}" was updated.`);
      } else {
        await api.post("/api/monitor/geofences", buildPayload(values));
        onSaved(`"${values.name}" was created.`);
      }
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrors(err.fields);
      else setErrors({ _form: err.message || "Could not save this geofence" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      title={isEdit ? `Edit ${fence.name}` : "New location"}
      subtitle="Draw the area on the map, then name it. The shape is saved exactly as drawn."
    >
      <form onSubmit={submit} className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Name" required error={errors.name} className="sm:col-span-2">
            <input value={values.name} onChange={set("name")} required className={inputClass(Boolean(errors.name))} />
          </Field>

          <Field label="Type" required error={errors.type}>
            <select value={type} onChange={set("type")} disabled={isEdit} className={inputClass()}>
              {FENCE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Status" error={errors.status}>
            <select value={values.status} onChange={set("status")} className={inputClass()}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </Field>
        </div>

        <Field label="Description" error={errors.description}>
          <input value={values.description} onChange={set("description")} className={inputClass()} />
        </Field>

        {/* ---------------------------------------------------------- drawing */}
        <div>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-label font-semibold uppercase text-ink-dim">Map</p>
              <p className="text-[12px] text-ink-dim">{TYPE_HINTS[type]}</p>
            </div>
            <button
              type="button"
              onClick={() => setDrawing((d) => !d)}
              className={cn(
                "flex items-center gap-1.5 rounded-pill border px-3 py-1.5 text-[12px] font-semibold transition",
                drawing
                  ? "border-brand bg-brand text-white"
                  : "border-line bg-surface text-ink-dim hover:border-brand/40 hover:text-ink"
              )}
            >
              <MapPin size={13} />
              {drawing ? "Drawing… click the map" : "Draw on map"}
            </button>
          </div>

          <FenceMap
            fences={[]}
            drawMode={drawing ? type : "none"}
            draft={draft}
            onPick={onPick}
            onUndo={undo}
            onClear={clearShape}
          />

          <div className="mt-2 flex flex-wrap items-center gap-2 text-[12px]">
            {type === "circle" ? (
              <ShapeSummary ok={values.center_lat !== ""}>
                {values.center_lat === ""
                  ? "No centre yet"
                  : `Centre ${Number(values.center_lat).toFixed(5)}, ${Number(values.center_lng).toFixed(5)}`}
              </ShapeSummary>
            ) : null}
            {type === "rectangle" ? (
              <ShapeSummary ok={Boolean(values.north)}>
                {values.north === ""
                  ? "No corners yet"
                  : `${Math.abs(Number(values.north) - Number(values.south)).toFixed(4)}° tall`}
              </ShapeSummary>
            ) : null}
            {type === "polygon" ? (
              <ShapeSummary ok={vertices >= 3}>{vertices} point{vertices === 1 ? "" : "s"}</ShapeSummary>
            ) : null}
            {type === "route" ? (
              <ShapeSummary ok={Boolean(values.origin && values.destination)}>
                {routePoints} point{routePoints === 1 ? "" : "s"}
                {draft?.distance_km ? ` · ${draft.distance_km} km` : ""}
              </ShapeSummary>
            ) : null}

            {(vertices || routePoints) > 0 ? (
              <button
                type="button"
                onClick={undo}
                className="flex items-center gap-1 text-[12px] font-semibold text-brand hover:underline"
              >
                <Undo2 size={12} />
                Undo last point
              </button>
            ) : null}
          </div>

          {errors._shape ? (
            <p role="alert" className="mt-1.5 text-[11.5px] font-medium text-crit">
              {errors._shape}
            </p>
          ) : null}
        </div>

        {/* ------------------------------------------------- type-specific */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {type === "circle" ? (
            <>
              <Field label="Radius (m)" required error={errors.radius_m}>
                <input
                  type="number"
                  min="1"
                  value={values.radius_m}
                  onChange={set("radius_m")}
                  className={inputClass(Boolean(errors.radius_m))}
                />
              </Field>
              <Field label="Extra tolerance (m)" hint="Widens the radius on top of it">
                <input type="number" min="0" value={values.buffer_m} onChange={set("buffer_m")} className={inputClass()} />
              </Field>
            </>
          ) : null}

          {type === "route" ? (
            <>
              <Field label="Corridor half-width (m)" error={errors.buffer_m} hint="Tolerance either side of the line">
                <input type="number" min="0" value={values.buffer_m} onChange={set("buffer_m")} className={inputClass()} />
              </Field>
              <Field label="Travel mode" error={errors.travel_mode}>
                <select value={values.travel_mode} onChange={set("travel_mode")} className={inputClass()}>
                  {TRAVEL_MODES.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </Field>
              {draft?.distance_km ? (
                <div className="sm:col-span-2">
                  <p className="text-label font-semibold uppercase text-ink-dim">Derived</p>
                  <p className="mt-1 text-[12.5px] text-ink">
                    {draft.distance_km} km · about {draft.duration_min} min by {values.travel_mode.toLowerCase()}
                  </p>
                  <p className="text-[11px] text-ink-dim">A planning estimate, not a billing figure.</p>
                </div>
              ) : null}
            </>
          ) : null}

          {type !== "route" ? (
            <Field label="Colour">
              <div className="flex items-center gap-1.5">
                {PRESET_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setValues((v) => ({ ...v, color: c }))}
                    aria-label={`Use colour ${c}`}
                    aria-pressed={values.color === c}
                    className={cn(
                      "h-6 w-6 rounded-full border-2 transition",
                      values.color === c ? "border-ink" : "border-transparent"
                    )}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
            </Field>
          ) : null}
        </div>

        {/* Latitude/longitude entry, for copying a fence from a survey. */}
        {type === "circle" ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Latitude" error={errors.center_lat}>
              <input
                value={values.center_lat}
                onChange={set("center_lat")}
                placeholder="32.4945"
                className={cn(inputClass(Boolean(errors.center_lat)), "font-mono")}
              />
            </Field>
            <Field label="Longitude" error={errors.center_lng}>
              <input
                value={values.center_lng}
                onChange={set("center_lng")}
                placeholder="74.5229"
                className={cn(inputClass(Boolean(errors.center_lng)), "font-mono")}
              />
            </Field>
          </div>
        ) : null}

        {errors._form ? (
          <p role="alert" className="flex items-center gap-1.5 text-[12.5px] font-medium text-crit">
            <AlertTriangle size={14} />
            {errors._form}
          </p>
        ) : null}

        <div className="flex gap-2">
          <button
            type="submit"
            disabled={busy}
            className="flex items-center gap-1.5 rounded-pill bg-brand px-4 py-2 text-[12.5px] font-semibold text-white transition hover:bg-brand-strong disabled:opacity-50"
          >
            {busy ? <Loader2 size={13} className="animate-spin" /> : null}
            {busy ? "Saving…" : isEdit ? "Save changes" : "Create location"}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-pill border border-line bg-surface px-4 py-2 text-[12.5px] font-semibold text-ink-dim transition hover:border-brand/40 hover:text-ink"
          >
            Cancel
          </button>
        </div>
      </form>
    </Card>
  );
}

function ShapeSummary({ ok, children }) {
  return (
    <span
      className={cn(
        "rounded-pill px-2 py-0.5 text-[11.5px] font-semibold",
        ok ? "bg-ok-tint text-ok" : "bg-surface-2 text-ink-dim"
      )}
    >
      {ok ? "✓ " : ""}
      {children}
    </span>
  );
}

/** Only the fields the API accepts, with the drawn geometry as numbers. */
function buildPayload(values) {
  const common = {
    name: values.name,
    description: values.description || "",
    color: values.color || "#2563eb",
    status: values.status || "active",
  };

  if (values.type === "circle") {
    return {
      ...common,
      type: "circle",
      center_lat: Number(values.center_lat),
      center_lng: Number(values.center_lng),
      radius_m: Number(values.radius_m),
      buffer_m: Number(values.buffer_m) || 0,
    };
  }

  if (values.type === "rectangle") {
    return {
      ...common,
      type: "rectangle",
      north: Number(values.north),
      south: Number(values.south),
      east: Number(values.east),
      west: Number(values.west),
      buffer_m: 0,
    };
  }

  if (values.type === "polygon") {
    return { ...common, type: "polygon", points: values.points, buffer_m: 0 };
  }

  return {
    ...common,
    type: "route",
    origin: values.origin,
    destination: values.destination,
    waypoints: values.waypoints || [],
    buffer_m: Number(values.buffer_m) || 50,
    travel_mode: values.travel_mode || "Driving",
  };
}

/**
 * Stored fence -> form values.
 *
 * Inverts the geometry the server built, so editing a rectangle or a route
 * shows the shape the admin originally drew rather than a blank form.
 */
export function fromFenceRow(fence) {
  const base = {
    ...BLANK,
    name: fence.name || "",
    description: fence.description || "",
    color: fence.color || "#2563eb",
    status: fence.status || "active",
    type: fence.type || "circle",
  };

  if (fence.type === "circle") {
    return {
      ...base,
      center_lat: fence.center_lat ?? "",
      center_lng: fence.center_lng ?? "",
      radius_m: fence.radius_m ?? 150,
      buffer_m: fence.buffer_m ?? 0,
    };
  }

  if (fence.type === "rectangle" && fence.geometry?.coordinates?.[0]) {
    const ring = fence.geometry.coordinates[0];
    const lats = ring.map((c) => c[1]);
    const lngs = ring.map((c) => c[0]);
    return {
      ...base,
      north: Math.max(...lats),
      south: Math.min(...lats),
      east: Math.max(...lngs),
      west: Math.min(...lngs),
    };
  }

  if (fence.type === "polygon" && fence.geometry?.coordinates?.[0]) {
    return {
      ...base,
      // Drop the repeated closing vertex; re-adding it is the builder's job.
      points: fence.geometry.coordinates[0].slice(0, -1).map(([lng, lat]) => ({ lat, lng })),
    };
  }

  if (fence.type === "route") {
    return {
      ...base,
      origin: fence.origin || null,
      destination: fence.destination || null,
      waypoints: fence.waypoints || [],
      buffer_m: fence.buffer_m ?? 50,
      travel_mode: fence.travel_mode || "Driving",
    };
  }

  return base;
}