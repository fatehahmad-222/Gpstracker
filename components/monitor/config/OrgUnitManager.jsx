"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Building2, Layers, Briefcase, Pencil, Plus, Trash2, X } from "lucide-react";

import { api, qs, ApiError } from "@/lib/monitor/client";
import { Card, StatusPill, CountPill, DataTable, columnDef, num } from "@/components/monitor/primitives";
import { ErrorState } from "@/components/monitor/states";
import { Field, inputClass } from "./fields";
import { cn } from "@/lib/utils";

/**
 * One screen for Departments, Sub-Departments and Designations.
 *
 * Spec 4.3 groups these three under Configuration and they differ only in the
 * parent they filter by, so they share this component. The parent lists are
 * fetched once and passed in so the form can offer a department filter without
 * a second round trip.
 */

const ICONS = { departments: Building2, sub_departments: Layers, designations: Briefcase };

export function OrgUnitManager({
  kind,
  title,
  subtitle,
  parentOptions = {},
  parentKey = null,
  addLabel,
}) {
  const spec = ICONS[kind];
  const Icon = ICONS[kind] || Building2;

  const [rows, setRows] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(null);
  const [showArchived, setShowArchived] = useState(false);
  const [notice, setNotice] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get(
        `/api/monitor/org-units${qs({ kind, include_inactive: showArchived ? "1" : "" })}`
      );
      setRows(data.rows || []);
    } catch (err) {
      setError(err.message || "Could not load this list");
    } finally {
      setLoading(false);
    }
  }, [kind, showArchived]);

  useEffect(() => {
    load();
  }, [load]);

  // Department options are needed by both the sub-department filter and the
  // designation form, so they load once regardless of which screen is mounted.
  useEffect(() => {
    if (departments.length) return;
    api
      .get(`/api/monitor/org-units${qs({ kind: "departments" })}`)
      .then((d) => setDepartments(d.rows || []))
      .catch(() => setDepartments([]));
  }, [departments.length]);

  const columns = useMemo(
    () => [
      columnDef({
        id: "name",
        accessorKey: "name",
        header: "Name",
        size: 220,
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <Icon size={14} className="shrink-0 text-ink-dim" aria-hidden="true" />
            <span className="truncate font-medium text-ink">{row.original.name}</span>
          </div>
        ),
      }),
      columnDef({
        id: "code",
        accessorKey: "code",
        header: "Code",
        size: 110,
        cell: ({ getValue }) => (
          <span className="font-mono text-[12px] text-ink-dim">{getValue() || "—"}</span>
        ),
      }),
      ...(parentKey
        ? [
            columnDef({
              id: "parent",
              header: "Department",
              size: 180,
              cell: ({ row }) => {
                const name = departments.find((d) => d.id === row.original.department_id)?.name;
                return <span className="truncate text-ink-dim">{name || "—"}</span>;
              },
            }),
          ]
        : []),
      columnDef({
        id: "employee_count",
        accessorKey: "employee_count",
        header: "Employees",
        size: 110,
        cell: ({ getValue }) => num(getValue() ?? 0),
      }),
      columnDef({
        id: "status",
        accessorKey: "status",
        header: "Status",
        size: 110,
        cell: ({ getValue }) => {
          const status = getValue();
          return (
            <StatusPill
              status={status === "active" ? "active" : "inactive"}
              label={status === "active" ? "Active" : "Archived"}
            />
          );
        },
      }),
      columnDef({
        id: "actions",
        header: "",
        size: 90,
        enableSorting: false,
        cell: ({ row }) => (
          <div className="flex justify-end gap-1">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setEditing(row.original);
              }}
              className="rounded-lg p-1.5 text-ink-dim transition hover:bg-surface-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              aria-label={`Edit ${row.original.name}`}
            >
              <Pencil size={13} />
            </button>
            <RemoveButton kind={kind} row={row.original} onDone={load} setNotice={setNotice} />
          </div>
        ),
      }),
    ],
    [departments, kind, parentKey, load]
  );

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="h-7 w-1.5 rounded-full bg-brand" aria-hidden="true" />
          <div>
            <h1 className="text-xl font-semibold text-ink">{title}</h1>
            {subtitle ? <p className="mt-0.5 text-[13px] text-ink-dim">{subtitle}</p> : null}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <CountPill tone="neutral">{rows.length} {rows.length === 1 ? "record" : "records"}</CountPill>
          <button
            type="button"
            onClick={() => setEditing({})}
            className="flex items-center gap-1.5 rounded-pill bg-brand px-3.5 py-1.5 text-[12.5px] font-semibold text-white transition hover:bg-brand-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
          >
            <Plus size={14} />
            {addLabel || "Add"}
          </button>
        </div>
      </header>

      {notice ? (
        <div
          role="status"
          className={cn(
            "rounded-tile border px-3 py-2 text-[12.5px]",
            notice.tone === "warn"
              ? "border-high/40 bg-high-tint text-high"
              : "border-brand/40 bg-brand-tint text-brand"
          )}
        >
          {notice.message}
        </div>
      ) : null}

      {editing ? (
        <OrgUnitForm
          kind={kind}
          row={editing}
          departments={departments}
          needsDepartment={kind !== "departments"}
          onCancel={() => setEditing(null)}
          onSaved={(message) => {
            setEditing(null);
            setNotice({ message });
            load();
          }}
        />
      ) : null}

      <Card
        title={null}
        bodyClassName="p-3"
        action={
          <label className="flex cursor-pointer items-center gap-2 text-[11.5px] text-ink-dim">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
              className="h-3.5 w-3.5 accent-[rgb(var(--brand))]"
            />
            Show archived
          </label>
        }
      >
        {error ? (
          <ErrorState hint={error} onRetry={load} />
        ) : (
          <DataTable
            data={rows}
            columns={columns}
            loading={loading}
            virtualizeAfter={200}
            getRowId={(row) => row.id}
            onRowClick={(row) => setEditing(row.original)}
            empty={{
              title: `No ${title.toLowerCase()} yet`,
              hint: `Add your first ${title.toLowerCase().replace(/s$/, "")} to get started.`,
              icon: Icon,
              action: (
                <button
                  type="button"
                  onClick={() => setEditing({})}
                  className="rounded-pill bg-brand px-3 py-1.5 text-[12px] font-semibold text-white"
                >
                  Add {title.toLowerCase().replace(/s$/, "")}
                </button>
              ),
            }}
            caption={title}
          />
        )}
      </Card>
    </div>
  );
}

function RemoveButton({ kind, row, onDone, setNotice }) {
  const [busy, setBusy] = useState(false);

  async function handleRemove() {
    const confirmed = window.confirm(
      `Remove "${row.name}"?\n\nIf employees are still assigned it will be archived instead, so their history is not lost.`
    );
    if (!confirmed) return;

    setBusy(true);
    try {
      const result = await api.delete(`/api/monitor/org-units/${kind}/${row.id}`);
      setNotice({
        tone: result.archived ? "warn" : "ok",
        message: result.archived
          ? `"${row.name}" was archived because ${result.employeeCount} employee(s) are still assigned to it.`
          : `"${row.name}" was removed.`,
      });
      onDone();
    } catch (err) {
      setNotice({ tone: "warn", message: err.message || "Could not remove this record" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        handleRemove();
      }}
      disabled={busy}
      className="rounded-lg p-1.5 text-ink-dim transition hover:bg-crit-tint hover:text-crit disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-crit"
      aria-label={`Remove ${row.name}`}
    >
      <Trash2 size={13} />
    </button>
  );
}

function OrgUnitForm({ kind, row, departments, needsDepartment, onCancel, onSaved }) {
  const isEdit = Boolean(row.id);
  const [values, setValues] = useState({
    name: row.name || "",
    code: row.code || "",
    status: row.status || "active",
    department_id: row.department_id || "",
    sub_department_id: row.sub_department_id || "",
  });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);

  const set = (key) => (e) => {
    const value = e?.target ? e.target.value : e;
    setValues((v) => ({ ...v, [key]: value }));
    setErrors((prev) => (prev[key] ? { ...prev, [key]: undefined } : prev));
  };

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setErrors({});

    const payload = {
      name: values.name,
      code: values.code,
      status: values.status,
      ...(needsDepartment ? { department_id: values.department_id } : {}),
      ...(kind === "designations" ? { sub_department_id: values.sub_department_id || null } : {}),
    };

    try {
      if (isEdit) {
        await api.patch(`/api/monitor/org-units/${kind}/${row.id}`, payload);
        onSaved(`"${values.name}" was updated.`);
      } else {
        await api.post("/api/monitor/org-units", { kind, values: payload });
        onSaved(`"${values.name}" was added.`);
      }
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrors(err.fields);
      else setErrors({ _form: err.message || "Could not save this record" });
    } finally {
      setBusy(false);
    }
  }

  const subDepartments = departments.filter((d) => d.id === values.department_id);

  return (
    <Card title={isEdit ? `Edit ${row.name}` : "Add a record"} subtitle="Changes apply to the whole company immediately.">
      <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" error={errors.name} required>
          <input
            value={values.name}
            onChange={set("name")}
            required
            placeholder="e.g. Sales"
            className={inputClass(Boolean(errors.name))}
          />
        </Field>

        <Field label="Code" hint="Optional short reference" error={errors.code}>
          <input
            value={values.code}
            onChange={set("code")}
            placeholder="e.g. SLS"
            className={cn(inputClass(Boolean(errors.code)), "font-mono")}
          />
        </Field>

        {needsDepartment ? (
          <Field label="Department" error={errors.department_id} required>
            <select value={values.department_id} onChange={set("department_id")} className={inputClass(Boolean(errors.department_id))}>
              <option value="">Select a department</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </Field>
        ) : null}

        {kind === "designations" ? (
          <Field label="Sub-Department" hint="Optional" error={errors.sub_department_id}>
            <select
              value={values.sub_department_id}
              onChange={set("sub_department_id")}
              disabled={!values.department_id}
              className={inputClass(Boolean(errors.sub_department_id))}
            >
              <option value="">
                {values.department_id ? "None" : "Choose a department first"}
              </option>
              {subDepartments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </Field>
        ) : null}

        {isEdit ? (
          <Field label="Status" hint="Archiving hides it from pickers but keeps history.">
            <select value={values.status} onChange={set("status")} className={inputClass(false)}>
              <option value="active">Active</option>
              <option value="inactive">Archived</option>
            </select>
          </Field>
        ) : null}

        {errors._form ? (
          <p role="alert" className="sm:col-span-2 text-[12px] font-medium text-crit">
            {errors._form}
          </p>
        ) : null}

        <div className="flex gap-2 sm:col-span-2">
          <button
            type="submit"
            disabled={busy}
            className="rounded-pill bg-brand px-4 py-2 text-[12.5px] font-semibold text-white transition hover:bg-brand-strong disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
          >
            {busy ? "Saving…" : isEdit ? "Save changes" : "Add"}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="flex items-center gap-1.5 rounded-pill border border-line bg-surface px-4 py-2 text-[12.5px] font-semibold text-ink-dim transition hover:border-brand/40 hover:text-ink"
          >
            <X size={13} />
            Cancel
          </button>
        </div>
      </form>
    </Card>
  );
}