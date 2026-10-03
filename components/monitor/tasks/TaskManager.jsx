"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { MapPin, Plus } from "lucide-react";

import { api, qs, ApiError } from "@/lib/monitor/client";
import { Card, DataTable, StatusPill, columnDef, CountPill, SegmentedControl } from "@/components/monitor/primitives";
import { ErrorState, EmptyState, TableSkeleton } from "@/components/monitor/states";
import { Field, inputClass } from "@/components/monitor/config/fields";
import {
  TASK_STATUSES,
  TASK_STATUS_META,
  canTransition,
  isOpen,
  matchesStatusFilter,
  nextStatuses,
  sortTasks,
  validateTask,
} from "@/lib/monitor/fieldTasks";

const EMPTY_FORM = {
  employee_id: "",
  title: "",
  description: "",
  target_lat: "",
  target_lng: "",
  target_address: "",
  radius_meters: "100",
  due_at: "",
};

const FILTERS = ["all", "open", "pending", "in_progress", "completed", "cancelled"];

/**
 * Field tasks.
 *
 * Reads the pre-existing `tasks` table rather than creating a parallel one, since
 * migration 0003 gave it a company_id for exactly this purpose. The consequence
 * is that an assignee is a profile id underneath, so this screen cannot offer a
 * task to an employee who has no login yet - the API returns a specific message
 * for that, and the employee picker marks those people up front rather than
 * letting someone pick someone and then get refused.
 */
export function TaskManager() {
  const [rows, setRows] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState("all");
  const [notice, setNotice] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [fieldErrors, setFieldErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get(`/api/monitor/tasks${qs({ status: filter === "all" || filter === "open" ? "" : filter })}`);
      setRows(data.rows || []);
      setIsAdmin(Boolean(data.is_admin));
    } catch (err) {
      setError(err.message || "Could not load tasks");
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    api
      .get(`/api/monitor/org-units${qs({ kind: "employees", page_size: 200 })}`)
      .then((data) => setEmployees(data.rows || []))
      .catch(() => {
        // Non-fatal: the picker is empty and filing is unavailable.
      });
  }, []);

  const submit = useCallback(
    async (event) => {
      event.preventDefault();
      const { errors, value } = validateTask(form);
      setFieldErrors(errors);
      if (!value) return;
      if (!form.employee_id) {
        setFieldErrors((e) => ({ ...e, employee_id: "Choose an employee" }));
        return;
      }

      setSaving(true);
      try {
        await api.post("/api/monitor/tasks", { ...value, employee_id: form.employee_id });
        setForm(EMPTY_FORM);
        setFieldErrors({});
        setNotice("Task created");
        await load();
      } catch (err) {
        if (err instanceof ApiError && err.data?.fields) setFieldErrors(err.data.fields);
        else setError(err.message || "Could not create that task");
      } finally {
        setSaving(false);
      }
    },
    [form, load]
  );

  const move = useCallback(
    async (id, status) => {
      setBusyId(id);
      try {
        await api.patch(`/api/monitor/tasks/${id}`, { status });
        setNotice(status === "completed" ? "Task completed" : `Task marked ${status.replace("_", " ")}`);
        await load();
      } catch (err) {
        setError(err.message || "Could not update that task");
      } finally {
        setBusyId(null);
      }
    },
    [load]
  );

  const columns = useMemo(
    () => [
      columnDef({
        id: "title",
        header: "Task",
        accessorKey: "title",
        cell: ({ row }) => (
          <span className="block min-w-0">
            <span className="block truncate text-[13px] font-medium text-ink">{row.original.title}</span>
            <span className="block truncate text-[11px] text-ink-dim">
              {row.original.employee_name || "Unassigned"}
              {row.original.employee_code ? ` · ${row.original.employee_code}` : ""}
            </span>
          </span>
        ),
      }),
      columnDef({
        id: "pin",
        header: "Location",
        size: 150,
        cell: ({ row }) =>
          row.original.target_lat == null ? (
            <span className="text-[11.5px] text-ink-dim">No pin</span>
          ) : (
            <span className="flex items-center gap-1.5 text-[12px] text-ink-2">
              <MapPin size={12} className="shrink-0 text-ink-dim" />
              <span className="truncate">
                {row.original.target_address || `${row.original.target_lat.toFixed(4)}, ${row.original.target_lng.toFixed(4)}`}
              </span>
            </span>
          ),
      }),
      columnDef({
        id: "due",
        header: "Due",
        size: 118,
        cell: ({ row }) => (
          <span className="font-mono text-[12px] text-ink-2">
            {row.original.due_at ? row.original.due_at.slice(0, 10) : "—"}
          </span>
        ),
      }),
      columnDef({
        id: "status",
        header: "Status",
        size: 112,
        cell: ({ row }) => {
          const meta = TASK_STATUS_META[row.original.status] || { label: row.original.status, status: "neutral" };
          return <StatusPill status={meta.status} label={meta.label} />;
        },
      }),
      columnDef({
        id: "actions",
        header: "",
        size: 168,
        sortable: false,
        enableHiding: false,
        cell: ({ row }) => {
          const allowed = isAdmin ? nextStatuses(row.original.status) : [];
          // A finished task offers nothing. Disabled buttons would suggest the
          // action is temporarily unavailable rather than already decided.
          if (allowed.length === 0) {
            return <span className="text-[11px] text-ink-dim">—</span>;
          }
          return (
            <span className="flex flex-wrap items-center gap-1">
              {allowed.map((next) => (
                <button
                  key={next}
                  type="button"
                  disabled={busyId === row.original.id}
                  onClick={() => move(row.original.id, next)}
                  title={next.replace("_", " ")}
                  aria-label={`Mark ${row.original.title} ${next.replace("_", " ")}`}
                  className={`rounded-md border border-line bg-surface-2 px-2 py-1 text-[11px] font-medium capitalize text-ink-2 transition hover:border-brand/40 hover:text-ink disabled:opacity-50 ${
                    next === "cancelled" ? "hover:border-crit/40" : ""
                  }`}
                >
                  {next.replace("_", " ")}
                </button>
              ))}
            </span>
          );
        },
      }),
    ],
    [busyId, isAdmin, move]
  );

  const visible = useMemo(
    () => sortTasks(rows.filter((r) => matchesStatusFilter(r, filter))),
    [rows, filter]
  );

  const counts = useMemo(() => {
    const out = { all: rows.length, open: rows.filter((r) => isOpen(r.status)).length };
    for (const s of TASK_STATUSES) out[s] = rows.filter((r) => r.status === s).length;
    return out;
  }, [rows]);

  return (
    <div className="space-y-4">
      {notice ? (
        <div role="status" className="rounded-pill border border-ok/30 bg-ok/10 px-3 py-2 text-[12.5px] font-medium text-ok">
          {notice}
        </div>
      ) : null}

      {isAdmin ? (
        <Card
          title="Assign a task"
          subtitle="Completion by geofence only applies to tasks that have a location."
        >
          <form onSubmit={submit} className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Employee" required error={fieldErrors.employee_id}>
                <select
                  value={form.employee_id}
                  onChange={(e) => setForm({ ...form, employee_id: e.target.value })}
                  className={inputClass}
                >
                  <option value="">Select employee</option>
                  {employees.map((e) => (
                    <option key={e.id} value={e.id} disabled={!e.profile_id}>
                      {e.name} {e.emp_code ? `(${e.emp_code})` : ""}
                      {e.profile_id ? "" : " — no login"}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Title" required error={fieldErrors.title} className="lg:col-span-3">
                <input
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  placeholder="What needs doing"
                  className={inputClass}
                />
              </Field>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Latitude" error={fieldErrors.target_lat} hint="Optional">
                <input
                  value={form.target_lat}
                  onChange={(e) => setForm({ ...form, target_lat: e.target.value })}
                  placeholder="24.8607"
                  className={inputClass}
                />
              </Field>
              <Field label="Longitude" error={fieldErrors.target_lng} hint="Optional">
                <input
                  value={form.target_lng}
                  onChange={(e) => setForm({ ...form, target_lng: e.target.value })}
                  placeholder="67.0011"
                  className={inputClass}
                />
              </Field>
              <Field label="Address" className="lg:col-span-2">
                <input
                  value={form.target_address}
                  onChange={(e) => setForm({ ...form, target_address: e.target.value })}
                  placeholder="Shown instead of coordinates"
                  className={inputClass}
                />
              </Field>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Arrival radius (m)" error={fieldErrors.radius_meters}>
                <input
                  value={form.radius_meters}
                  onChange={(e) => setForm({ ...form, radius_meters: e.target.value })}
                  className={inputClass}
                />
              </Field>
              <Field label="Due" error={fieldErrors.due_at}>
                <input
                  type="datetime-local"
                  value={form.due_at}
                  onChange={(e) => setForm({ ...form, due_at: e.target.value })}
                  className={inputClass}
                />
              </Field>
            </div>

            <Field label="Description">
              <textarea
                rows={2}
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                className={inputClass}
              />
            </Field>

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={saving}
                className="inline-flex items-center gap-1.5 rounded-pill bg-brand px-3.5 py-1.5 text-[12.5px] font-semibold text-white transition disabled:opacity-50"
              >
                <Plus size={13} />
                {saving ? "Creating…" : "Create task"}
              </button>
            </div>
          </form>
        </Card>
      ) : null}

      <Card
        title="Tasks"
        actions={
          <SegmentedControl
            name="Task status"
            size="sm"
            value={filter}
            onChange={setFilter}
            options={FILTERS.map((f) => ({
              value: f,
              label: `${f === "all" ? "All" : f === "open" ? "Open" : f[0].toUpperCase() + f.slice(1).replace("_", " ")} ${counts[f]}`,
            }))}
          />
        }
      >
        {loading ? (
          <TableSkeleton />
        ) : error ? (
          <ErrorState message={error} onRetry={load} />
        ) : visible.length === 0 ? (
          <EmptyState
            title="No tasks"
            hint={filter === "all" ? "Nothing has been assigned yet." : "Nothing matches this filter."}
          />
        ) : (
          <DataTable
            data={visible}
            columns={columns}
            getRowId={(row) => row.id}
            initialSort={[{ id: "status", desc: false }]}
          />
        )}
      </Card>
    </div>
  );
}