"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ClipboardCheck, Pencil, Plus, Trash2, X, Calculator } from "lucide-react";

import { api, qs, ApiError } from "@/lib/monitor/client";
import { Card, StatusPill, CountPill, DataTable, columnDef, RadioCard, SegmentedControl } from "@/components/monitor/primitives";
import { ErrorState } from "@/components/monitor/states";
import {
  METHOD_LABEL,
  METHOD_HELPER,
  METHOD_PLACEHOLDER,
  computeDeduction,
} from "@/lib/monitor/deduction";
import { Field, inputClass } from "./fields";
import { cn } from "@/lib/utils";

const POLICY_TYPES = [
  { value: "late_early_deduction", label: "Late / Early deduction Form" },
  { value: "presence_check", label: "Presence Check Form" },
];

/**
 * Policies (spec 4.4).
 *
 * Two forms on one screen, as in the reference product: a radio choice between
 * the deduction form and the presence check form, with the conditional amount
 * field appearing only for the deduction method that needs it.
 */
export function PolicyManager() {
  const [rows, setRows] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState("all");
  const [editing, setEditing] = useState(null);
  const [notice, setNotice] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get(`/api/monitor/policies${qs({ type: filter === "all" ? "" : filter })}`);
      setRows(data.rows || []);
    } catch (err) {
      setError(err.message || "Could not load policies");
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    load();
  }, [load]);

  // The policy scope picker needs the org tree and the employee list.
  useEffect(() => {
    Promise.all([
      api.get(`/api/monitor/org-units${qs({ kind: "departments" })}`),
      api.get(`/api/monitor/org-units${qs({ kind: "employees", page_size: 200 })}`),
    ])
      .then(([depts, staff]) => {
        setDepartments(depts.rows || []);
        setEmployees(staff.rows || []);
      })
      .catch(() => {
        // A failed lookup must not block the screen; the picker shows a hint.
      });
  }, []);

  const columns = useMemo(
    () => [
      columnDef({
        id: "name",
        accessorKey: "name",
        header: "Policy",
        size: 240,
        cell: ({ row }) => (
          <div className="min-w-0">
            <div className="truncate font-medium text-ink">{row.original.name}</div>
            {row.original.description ? (
              <div className="truncate text-[11px] text-ink-dim">{row.original.description}</div>
            ) : null}
          </div>
        ),
      }),
      columnDef({
        id: "type",
        accessorKey: "type",
        header: "Type",
        size: 190,
        cell: ({ getValue }) => (
          <span className="text-[12px] text-ink-dim">
            {POLICY_TYPES.find((t) => t.value === getValue())?.label || getValue()}
          </span>
        ),
      }),
      columnDef({
        id: "scope_label",
        accessorKey: "scope_label",
        header: "Applies to",
        size: 170,
        cell: ({ getValue }) => <span className="truncate text-ink">{getValue()}</span>,
      }),
      columnDef({
        id: "rule",
        header: "Rule",
        size: 230,
        cell: ({ row }) => <span className="text-[12px] text-ink-dim">{describeRule(row.original)}</span>,
      }),
      columnDef({
        id: "deduction_preview",
        header: "30 min late",
        size: 130,
        cell: ({ row }) =>
          row.original.deduction_preview == null ? (
            <span className="text-ink-dim">—</span>
          ) : (
            <span className="font-mono font-semibold tabular-nums text-ink">
              PKR {row.original.deduction_preview}
            </span>
          ),
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
              label={status === "active" ? "Active" : "Inactive"}
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
              onClick={() => setEditing(row.original)}
              className="rounded-lg p-1.5 text-ink-dim transition hover:bg-surface-2 hover:text-ink"
              aria-label={`Edit ${row.original.name}`}
            >
              <Pencil size={13} />
            </button>
            <RemovePolicy row={row.original} onDone={load} setNotice={setNotice} />
          </div>
        ),
      }),
    ],
    [load]
  );

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="h-7 w-1.5 rounded-full bg-brand" aria-hidden="true" />
          <div>
            <h1 className="text-xl font-semibold text-ink">Policies</h1>
            <p className="mt-0.5 text-[13px] text-ink-dim">
              Deduction rules and presence checks. A policy applies company-wide or to one department or employee.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <CountPill tone="neutral">{rows.length} {rows.length === 1 ? "policy" : "policies"}</CountPill>
          <button
            type="button"
            onClick={() => setEditing({ type: "late_early_deduction" })}
            className="flex items-center gap-1.5 rounded-pill bg-brand px-3.5 py-1.5 text-[12.5px] font-semibold text-white transition hover:bg-brand-strong"
          >
            <Plus size={14} />
            Add policy
          </button>
        </div>
      </header>

      <SegmentedControl
        name="Policy type filter"
        value={filter}
        onChange={setFilter}
        options={[
          { value: "all", label: "All" },
          ...POLICY_TYPES.map((t) => ({ value: t.value, label: t.label.split(" ")[0] })),
        ]}
      />

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
        <PolicyForm
          policy={editing}
          departments={departments}
          employees={employees}
          onCancel={() => setEditing(null)}
          onSaved={(message) => {
            setEditing(null);
            setNotice({ message });
            load();
          }}
        />
      ) : null}

      <Card bodyClassName="p-3" title={null}>
        {error ? (
          <ErrorState hint={error} onRetry={load} />
        ) : (
          <DataTable
            data={rows}
            columns={columns}
            loading={loading}
            getRowId={(row) => row.id}
            onRowClick={(row) => setEditing(row)}
            empty={{
              title: "No policies yet",
              hint: "Add a deduction or presence check policy to start enforcing your rules.",
              icon: ClipboardCheck,
            }}
            caption="Policies"
          />
        )}
      </Card>
    </div>
  );
}

function describeRule(policy) {
  const p = policy.params || {};
  if (policy.type === "late_early_deduction") {
    const amount =
      p.method === "per_minute"
        ? `PKR ${p.amount}/min`
        : p.method === "salary_based"
          ? "salary pro-rata"
          : `PKR ${p.amount} flat`;
    return `${p.grace_minutes} min grace · ${amount}`;
  }
  return `Selfie within ${p.selfie_grace_minutes} min · ${p.notifications} reminder(s)`;
}

function RemovePolicy({ row, onDone, setNotice }) {
  const [busy, setBusy] = useState(false);

  async function handleRemove() {
    if (!window.confirm(`Delete the policy "${row.name}"? This cannot be undone.`)) return;
    setBusy(true);
    try {
      await api.delete(`/api/monitor/policies/${row.id}`);
      setNotice({ message: `"${row.name}" was deleted.` });
      onDone();
    } catch (err) {
      setNotice({ tone: "warn", message: err.message || "Could not delete this policy" });
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
      className="rounded-lg p-1.5 text-ink-dim transition hover:bg-crit-tint hover:text-crit disabled:opacity-50"
      aria-label={`Delete ${row.name}`}
    >
      <Trash2 size={13} />
    </button>
  );
}

function PolicyForm({ policy, departments, employees, onCancel, onSaved }) {
  const isEdit = Boolean(policy.id);
  const p = policy.params || {};

  const [values, setValues] = useState({
    type: policy.type || "late_early_deduction",
    name: policy.name || "",
    description: policy.description || "",
    effective_from: policy.effective_from || new Date().toISOString().slice(0, 10),
    status: policy.status || "active",
    scope: policy.scope || "all",
    scope_ref_id: policy.scope_ref_id || "",
    // deduction
    grace_minutes: p.grace_minutes ?? 15,
    method: p.method || "fixed",
    amount: p.amount ?? 0,
    max_deduction: p.max_deduction ?? "",
    warn_after: p.warn_after ?? 5,
    // presence
    selfie_grace_minutes: p.selfie_grace_minutes ?? 10,
    notifications: p.notifications ?? 2,
  });

  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);

  const set = (key) => (e) => {
    const value = e?.target ? e.target.value : e;
    setValues((v) => ({ ...v, [key]: value }));
    setErrors((prev) => (prev[key] ? { ...prev, [key]: undefined } : prev));
  };

  const isDeduction = values.type === "late_early_deduction";

  // Live preview of what the current settings would charge for a 30-minute
  // lateness, so the admin sees the consequence before saving.
  const preview = computeDeduction({
    lateMinutes: 30,
    method: values.method,
    amount: Number(values.amount) || 0,
    graceMinutes: Number(values.grace_minutes) || 0,
    maxDeduction: values.max_deduction === "" ? null : Number(values.max_deduction),
  });

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setErrors({});

    const payload = {
      name: values.name,
      description: values.description,
      effective_from: values.effective_from,
      status: values.status,
      scope: values.scope,
      scope_ref_id: values.scope === "all" ? "" : values.scope_ref_id,
      ...(isDeduction
        ? {
            grace_minutes: Number(values.grace_minutes),
            method: values.method,
            amount: Number(values.amount) || 0,
            max_deduction: values.max_deduction === "" ? null : Number(values.max_deduction),
            warn_after: Number(values.warn_after),
          }
        : {
            selfie_grace_minutes: Number(values.selfie_grace_minutes),
            notifications: Number(values.notifications),
          }),
    };

    try {
      if (isEdit) {
        await api.patch(`/api/monitor/policies/${policy.id}`, { type: values.type, values: payload });
        onSaved(`"${values.name}" was updated.`);
      } else {
        await api.post("/api/monitor/policies", { type: values.type, values: payload });
        onSaved(`"${values.name}" was created.`);
      }
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrors(err.fields);
      else setErrors({ _form: err.message || "Could not save this policy" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      title={isEdit ? `Edit ${policy.name}` : "Add a policy"}
      subtitle="Policies take effect from the date you choose and apply to everyone in scope."
    >
      <form onSubmit={submit} className="space-y-5">
        {!isEdit ? (
          <fieldset>
            <legend className="mb-2 text-label font-semibold uppercase text-ink-dim">
              Policy form
            </legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {POLICY_TYPES.map((t) => (
                <RadioCard
                  key={t.value}
                  name="policy-type"
                  value={t.value}
                  selected={values.type === t.value}
                  onChange={(v) => setValues((s) => ({ ...s, type: v }))}
                  title={t.label}
                  description={
                    t.value === "late_early_deduction"
                      ? "Deduct pay when someone clocks in late or out early."
                      : "Ask staff to confirm they are on site with a selfie."
                  }
                  icon={t.value === "late_early_deduction" ? Calculator : ClipboardCheck}
                />
              ))}
            </div>
          </fieldset>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Policy name" required error={errors.name}>
            <input
              value={values.name}
              onChange={set("name")}
              required
              placeholder="e.g. Standard 15 minute grace"
              className={inputClass(Boolean(errors.name))}
            />
          </Field>

          <Field label="Effective from" required error={errors.effective_from}>
            <input
              type="date"
              value={values.effective_from}
              onChange={set("effective_from")}
              className={inputClass(Boolean(errors.effective_from))}
            />
          </Field>

          <Field label="Applies to" error={errors.scope}>
            <select value={values.scope} onChange={set("scope")} className={inputClass(false)}>
              <option value="all">All employees</option>
              <option value="department">One department</option>
              <option value="employee">One employee</option>
            </select>
          </Field>

          {values.scope === "department" ? (
            <Field label="Department" required error={errors.scope_ref_id}>
              <select
                value={values.scope_ref_id}
                onChange={set("scope_ref_id")}
                className={inputClass(Boolean(errors.scope_ref_id))}
              >
                <option value="">Select a department</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </Field>
          ) : null}

          {values.scope === "employee" ? (
            <Field
              label="Employee"
              required
              error={errors.scope_ref_id}
              hint={employees.length ? undefined : "No employees found for this company."}
            >
              <select
                value={values.scope_ref_id}
                onChange={set("scope_ref_id")}
                className={inputClass(Boolean(errors.scope_ref_id))}
              >
                <option value="">Select an employee</option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                    {e.code ? ` (${e.code})` : ""}
                  </option>
                ))}
              </select>
            </Field>
          ) : null}

          {isEdit ? (
            <Field label="Status" hint="Inactive policies stop applying but stay on record.">
              <select value={values.status} onChange={set("status")} className={inputClass(false)}>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </Field>
          ) : null}

          <Field label="Description" hint="Optional" error={errors.description}>
            <input
              value={values.description}
              onChange={set("description")}
              className={inputClass(Boolean(errors.description))}
            />
          </Field>
        </div>

        {isDeduction ? (
          <fieldset className="rounded-tile border border-line bg-surface-2/50 p-4">
            <legend className="px-1 text-label font-semibold uppercase text-brand">Deduction rules</legend>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Grace period (minutes)" hint="Late time inside this is never charged">
                <input
                  type="number"
                  min="0"
                  max="240"
                  value={values.grace_minutes}
                  onChange={set("grace_minutes")}
                  className={inputClass(false)}
                />
              </Field>

              <Field label="Deduction method">
                <select value={values.method} onChange={set("method")} className={inputClass(false)}>
                  {Object.entries(METHOD_LABEL).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </Field>

              <Field
                label={values.method === "per_minute" ? "Amount per minute (PKR)" : "Amount (PKR)"}
                hint={METHOD_HELPER[values.method]}
                required={values.method !== "salary_based"}
                error={errors.amount}
              >
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={values.amount}
                  onChange={set("amount")}
                  disabled={values.method === "salary_based"}
                  placeholder={METHOD_PLACEHOLDER[values.method] || ""}
                  className={inputClass(Boolean(errors.amount))}
                />
              </Field>

              <Field label="Maximum deduction (PKR)" hint="Blank for no cap" error={errors.max_deduction}>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={values.max_deduction}
                  onChange={set("max_deduction")}
                  placeholder="No cap"
                  className={inputClass(Boolean(errors.max_deduction))}
                />
              </Field>

              <Field label="Warn after (occurrences)" hint="Flag the employee for a warning">
                <input
                  type="number"
                  min="1"
                  max="100"
                  value={values.warn_after}
                  onChange={set("warn_after")}
                  className={inputClass(false)}
                />
              </Field>
            </div>

            <p className="mt-3 flex items-center gap-1.5 rounded-lg bg-surface px-3 py-2 text-[12px] text-ink-dim">
              <Calculator size={13} className="shrink-0 text-brand" aria-hidden="true" />
              {values.method === "salary_based" ? (
                <>Salary-based deduction is calculated per employee from their own salary and shift length.</>
              ) : (
                <>
                  An employee 30 minutes late would be charged{" "}
                  <strong className="font-semibold text-ink">PKR {preview.amount}</strong>
                  {preview.capped ? ` (capped at PKR ${preview.cappedAt})` : ""}.
                </>
              )}
            </p>
          </fieldset>
        ) : (
          <fieldset className="rounded-tile border border-line bg-surface-2/50 p-4">
            <legend className="px-1 text-label font-semibold uppercase text-brand">Presence check rules</legend>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Selfie grace (minutes)" hint="Time allowed to respond">
                <input
                  type="number"
                  min="1"
                  max="120"
                  value={values.selfie_grace_minutes}
                  onChange={set("selfie_grace_minutes")}
                  className={inputClass(false)}
                />
              </Field>
              <Field label="Reminders" hint="How many nudges before it counts as missed">
                <input
                  type="number"
                  min="1"
                  max="3"
                  value={values.notifications}
                  onChange={set("notifications")}
                  className={inputClass(false)}
                />
              </Field>
            </div>
          </fieldset>
        )}

        {errors._form ? (
          <p role="alert" className="text-[12px] font-medium text-crit">
            {errors._form}
          </p>
        ) : null}

        <div className="flex gap-2">
          <button
            type="submit"
            disabled={busy}
            className="rounded-pill bg-brand px-4 py-2 text-[12.5px] font-semibold text-white transition hover:bg-brand-strong disabled:opacity-60"
          >
            {busy ? "Saving…" : isEdit ? "Save changes" : "Create policy"}
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