"use client";

import { useState } from "react";import dynamic from "next/dynamic";
import { Loader2, MapPin, Trash2 } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Input, Textarea } from "@/components/ui/Input";
import { Avatar } from "@/components/ui/Avatar";
import { supabase } from "@/lib/supabaseClient";
import { useAuth } from "@/components/providers/AuthProvider";
import NominatimSearch from "./NominatimSearch";
import { MapLoading } from "@/components/map/MapLoading";
import { cn } from "@/lib/utils";

const TargetPickerMap = dynamic(() => import("@/components/map/TargetPickerMap"), {
  ssr: false,
  loading: () => (
    <div className="h-64 w-full">
      <MapLoading />
    </div>
  ),
});

export default function NewTaskModal({ open, onClose, employees, defaultEmployeeId }) {
  const { profile } = useAuth();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [assigneeIds, setAssigneeIds] = useState(
    defaultEmployeeId ? [defaultEmployeeId] : []
  );
  const [target, setTarget] = useState(null);
  const [radius, setRadius] = useState(100);
  const [dueAt, setDueAt] = useState("");
  const [flyTo, setFlyTo] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const reset = () => {
    setTitle("");
    setDescription("");
    setAssigneeIds(defaultEmployeeId ? [defaultEmployeeId] : []);
    setTarget(null);
    setRadius(100);
    setDueAt("");
    setFlyTo(null);
    setError(null);
  };

  const toggleAssignee = (id) => {
    setAssigneeIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const pickTarget = (pick) => {
    setTarget(pick);
    setFlyTo({ lat: pick.lat, lng: pick.lng, ts: Date.now() });
  };

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);

    if (!title.trim()) return setError("Give the task a title.");
    if (assigneeIds.length === 0) return setError("Choose at least one employee.");
    if (!target) return setError("Pick a target location on the map or search an address.");

    setSaving(true);
    try {
      for (const employeeId of assigneeIds) {
        const { error } = await supabase.from("tasks").insert({
          admin_id: profile?.id ?? null,
          employee_id: employeeId,
          title: title.trim(),
          description: description.trim(),
          target_lat: target.lat,
          target_lng: target.lng,
          target_address: target.address ?? null,
          radius_meters: radius,
          due_at: dueAt ? new Date(dueAt).toISOString() : null,
        });
        if (error) throw error;
      }
      reset();
      onClose();
    } catch (err) {
      setError(err.message ?? "Unable to assign task.");
    } finally {
      setSaving(false);
    }
  }

  const singleEmployee = employees.length === 1 && defaultEmployeeId;

  return (
    <Modal open={open} onClose={onClose} title="Assign new task" size="lg">
      <form onSubmit={handleSubmit} className="space-y-6 p-5">
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Left: details */}
          <div className="space-y-4">
            <Field label="Assign to">
              {singleEmployee ? (
                <div className="flex items-center gap-2.5 rounded-field border border-line bg-surface-2 px-3 py-2.5">
                  <Avatar name={employees[0].full_name} size={28} />
                  <span className="text-sm font-medium text-ink">
                    {employees[0].full_name}
                  </span>
                </div>
              ) : (
                <div className="max-h-40 space-y-1 overflow-y-auto rounded-field border border-line bg-bg p-2">
                  {employees.map((emp) => {
                    const checked = assigneeIds.includes(emp.id);
                    return (
                      <label
                        key={emp.id}
                        className={cn(
                          "flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors",
                          checked ? "bg-accent/10" : "hover:bg-surface-2"
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleAssignee(emp.id)}
                          className="h-4 w-4 accent-[rgb(var(--accent))]"
                        />
                        <Avatar name={emp.full_name} size={26} />
                        <span className="text-sm text-ink">{emp.full_name}</span>
                      </label>
                    );
                  })}
                </div>
              )}
            </Field>

            <Field label="Title">
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Visit Green Market outlet"
                required
              />
            </Field>

            <Field label="Description">
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Any instructions for the employee…"
                rows={3}
              />
            </Field>

            <Field label={`Geofence radius · ${radius} m`}>
              <input
                type="range"
                min={25}
                max={500}
                step={25}
                value={radius}
                onChange={(e) => setRadius(Number(e.target.value))}
                className="w-full accent-[rgb(var(--accent))]"
              />
              <span className="mt-1 block text-xs text-ink-dim">
                The task auto-completes when the employee enters this radius.
              </span>
            </Field>

            <Field label="Due date & time (optional)">
              <Input
                type="datetime-local"
                value={dueAt}
                onChange={(e) => setDueAt(e.target.value)}
              />
            </Field>
          </div>

          {/* Right: target */}
          <div>
            <Field label="Target location">
              <NominatimSearch
                onPick={pickTarget}
                placeholder="Search an address or place…"
                className="mb-2"
              />
              <div className="relative overflow-hidden rounded-field border border-line">
                <TargetPickerMap
                  target={target}
                  radius={radius}
                  flyTo={flyTo}
                  onPick={(lat, lng) => pickTarget({ lat, lng, address: null })}
                />
                {!target && (
                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                    <div className="rounded-pill border border-line bg-surface/90 px-3 py-1.5 text-xs text-ink-dim backdrop-blur">
                      Click anywhere on the map to set the target
                    </div>
                  </div>
                )}
              </div>

              {target && (
                <div className="mt-2 flex items-start justify-between gap-2 rounded-field border border-accent/25 bg-accent/8 px-3 py-2">
                  <div className="flex min-w-0 items-start gap-2">
                    <MapPin size={14} className="mt-0.5 shrink-0 text-accent" />
                    <span className="line-clamp-2 text-xs text-ink">
                      {target.address ||
                        `${target.lat.toFixed(5)}, ${target.lng.toFixed(5)}`}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setTarget(null)}
                    className="shrink-0 text-ink-dim transition-colors hover:text-danger"
                    aria-label="Clear target"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              )}
            </Field>
          </div>
        </div>

        {error && (
          <div className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2.5 text-sm text-danger">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2 border-t border-line pt-4">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? <Loader2 size={16} className="animate-spin" /> : null}
            {saving ? "Assigning…" : `Assign to ${assigneeIds.length} employee${assigneeIds.length === 1 ? "" : "s"}`}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
