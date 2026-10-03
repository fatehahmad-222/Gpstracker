"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Plus, X } from "lucide-react";

import { api, qs, ApiError } from "@/lib/monitor/client";
import { Card, DataTable, StatusPill, columnDef, CountPill, SegmentedControl, SectionLabel } from "@/components/monitor/primitives";
import { ErrorState, EmptyState, TableSkeleton } from "@/components/monitor/states";
import { Field, inputClass } from "@/components/monitor/config/fields";
import {
  LEAVE_TYPES,
  LEAVE_STATUSES,
  LEAVE_STATUS_META,
  canDecide,
  countDays,
  matchesStatusFilter,
  overlapsExisting,
  sortLeaves,
  validateLeaveRequest,
} from "@/lib/monitor/leaves";

const EMPTY_FORM = {
  employee_id: "",
  leave_type: "casual",
  from_date: "",
  to_date: "",
  reason: "",
};

/**
 * Leave requests.
 *
 * Two audiences on one screen: an employee files their own and can see what
 * happened to it, and an admin works the queue and decides. The API already
 * refuses an employee the list, so this renders the queue only for staff.
 *
 * Approve and reject are inline rather than behind a modal because a request is
 * a single yes/no and the surrounding context - who, which days, why - is what
 * the decision needs. A modal hides exactly that.
 */
export function LeaveManager() {
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
      const data = await api.get(`/api/monitor/leaves${qs({ status: filter === "all" ? "" : filter })}`);
      setRows(data.rows || []);
      setIsAdmin(Boolean(data.is_admin));
    } catch (err) {
      setError(err.message || "Could not load leave requests");
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
        // The picker degrades to an empty list; filing is then unavailable, which
        // is better than offering a picker that cannot submit.
      });
  }, []);

  // Warn about overlapping days without blocking. Re-requesting the same dates
  // after a rejection is legitimate, so this is advisory.
  const overlapWarning = useMemo(() => {
    const { value } = validateLeaveRequest(form);
    if (!value) return null;
    const mine = form.employee_id
      ? rows.filter((r) => r.employee_id === form.employee_id)
      : rows;
    return overlapsExisting(value, mine) ? "This overlaps an existing request for those days." : null;
  }, [form, rows]);

  const submit = useCallback(
    async (event) => {
      event.preventDefault();
      const { errors, value } = validateLeaveRequest(form);
      setFieldErrors(errors);
      if (!value) return;

      setSaving(true);
      try {
        await api.post("/api/monitor/leaves", value);
        setForm(EMPTY_FORM);
        setFieldErrors({});
        setNotice("Leave request filed");
        await load();
      } catch (err) {
        // Prefer per-field messages from the server so the error lands on the input
        // that caused it rather than in a banner.
        if (err instanceof ApiError && err.data?.fields) setFieldErrors(err.data.fields);
        else setError(err.message || "Could not file that request");
      } finally {
        setSaving(false);
      }
    },
    [form, load]
  );

  const decide = useCallback(
    async (id, action) => {
      setBusyId(id);
      try {
        await api.patch(`/api/monitor/leaves/${id}`, { action });
        setNotice(action === "approve" ? "Request approved" : "Request rejected");
        await load();
      } catch (err) {
        setError(err.message || "Could not record that decision");
      } finally {
        setBusyId(null);
      }
    },
    [load]
  );

  const columns = useMemo(
    () => [
      columnDef({
        id: "employee",
        header: "Employee",
        accessorKey: "employee_name",
        cell: ({ row }) => (
          <span className="block min-w-0">
            <span className="block truncate text-[13px] font-medium text-ink">
              {row.original.employee_name || "Unknown"}
            </span>
            <span className="block font-mono text-[11px] text-ink-dim">
              {row.original.employee_code || "-"}
            </span>
          </span>
        ),
      }),
      columnDef({
        id: "type",
        header: "Type",
        accessorKey: "leave_type",
        cell: ({ row }) => (
          <span className="text-[12.5px] capitalize text-ink-2">
            {row.original.leave_type || "casual"}
          </span>
        ),
      }),
      columnDef({
        id: "dates",
        header: "Dates",
        size: 190,
        cell: ({ row }) => (
          <span className="block">
            <span className="block font-mono text-[12px] text-ink">
              {row.original.from_date} → {row.original.to_date}
            </span>
            <span className="block text-[11px] text-ink-dim">
              {countDays(row.original.from_date, row.original.to_date)} day
              {countDays(row.original.from_date, row.original.to_date) === 1 ? "" : "s"}
            </span>
          </span>
        ),
      }),
      columnDef({
        id: "reason",
        header: "Reason",
        accessorKey: "reason",
        cell: ({ row }) => (
          <span className="line-clamp-2 block text-[12px] text-ink-2">
            {row.original.reason || "—"}
          </span>
        ),
      }),
      columnDef({
        id: "status",
        header: "Status",
        size: 108,
        cell: ({ row }) => {
          const meta = LEAVE_STATUS_META[row.original.status] || { label: row.original.status, status: "neutral" };
          return <StatusPill status={meta.status} label={meta.label} />;
        },
      }),
      columnDef({
        id: "actions",
        header: "",
        size: 132,
        sortable: false,
        enableHiding: false,
        cell: ({ row }) =>
          // A decided request offers nothing. Showing disabled buttons would imply
          // the action is merely unavailable right now rather than already taken.
          !isAdmin || !canDecide(row.original.status) ? (
            <span className="text-[11px] text-ink-dim">—</span>
          ) : (
            <span className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => decide(row.original.id, "approve")}
                disabled={busyId === row.original.id}
                title="Approve"
                aria-label={`Approve leave for ${row.original.employee_name || "employee"}`}
                className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-line bg-surface-2 text-ok transition hover:border-ok/40 disabled:opacity-50"
              >
                <Check size={13} />
              </button>
              <button
                type="button"
                onClick={() => decide(row.original.id, "reject")}
                disabled={busyId === row.original.id}
                title="Reject"
                aria-label={`Reject leave for ${row.original.employee_name || "employee"}`}
                className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-line bg-surface-2 text-crit transition hover:border-crit/40 disabled:opacity-50"
              >
                <X size={13} />
              </button>
            </span>
          ),
      }),
    ],
    [busyId, decide, isAdmin]
  );

  const visible = useMemo(
    () => sortLeaves(rows.filter((r) => matchesStatusFilter(r, filter))),
    [rows, filter]
  );

  const counts = useMemo(() => {
    const out = { all: rows.length };
    for (const s of LEAVE_STATUSES) out[s] = rows.filter((r) => r.status === s).length;
    return out;
  }, [rows]);

  return (
    <div className="space-y-4">
      {notice ? (
        <div role="status" className="rounded-pill border border-ok/30 bg-ok/10 px-3 py-2 text-[12.5px] font-medium text-ok">
          {notice}
        </div>
      ) : null}

      <Card
        title="File a leave request"
        subtitle="Recorded as pending. An administrator approves or rejects it."
        actions={<CountPill label={`${visible.length} shown`} />}
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
                  <option key={e.id} value={e.id}>
                    {e.name} {e.emp_code ? `(${e.emp_code})` : ""}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Type">
              <select
                value={form.leave_type}
                onChange={(e) => setForm({ ...form, leave_type: e.target.value })}
                className={inputClass}
              >
                {LEAVE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t[0].toUpperCase() + t.slice(1)}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="From" required error={fieldErrors.from_date}>
              <input
                type="date"
                value={form.from_date}
                onChange={(e) => setForm({ ...form, from_date: e.target.value })}
                className={inputClass}
              />
            </Field>

            <Field label="To" required error={fieldErrors.to_date}>
              <input
                type="date"
                value={form.to_date}
                onChange={(e) => setForm({ ...form, to_date: e.target.value })}
                className={inputClass}
              />
            </Field>
          </div>

          <Field label="Reason" error={fieldErrors.reason} hint={overlapWarning}>
            <textarea
              rows={2}
              value={form.reason}
              onChange={(e) => setForm({ ...form, reason: e.target.value })}
              placeholder="Optional context for the approver"
              className={inputClass}
            />
          </Field>

          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setForm(EMPTY_FORM);
                setFieldErrors({});
              }}
              className="rounded-pill border border-line bg-surface-2 px-3 py-1.5 text-[12.5px] font-medium text-ink-2 transition hover:text-ink"
            >
              Clear
            </button>
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-pill bg-brand px-3.5 py-1.5 text-[12.5px] font-semibold text-white transition disabled:opacity-50"
            >
              <Plus size={13} />
              {saving ? "Filing…" : "File request"}
            </button>
          </div>
        </form>
      </Card>

      <Card
        title="Requests"
        actions={
          <SegmentedControl
            name="Leave status"
            size="sm"
            value={filter}
            onChange={setFilter}
            options={["all", ...LEAVE_STATUSES].map((s) => ({
              value: s,
              label: s === "all" ? `All ${counts.all}` : `${s[0].toUpperCase()}${s.slice(1)} ${counts[s]}`,
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
            title="No leave requests"
            hint={
              filter === "all"
                ? "Nothing has been filed yet."
                : `No ${filter} requests right now.`
            }
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

      {!isAdmin ? (
        <SectionLabel>Approvals require an administrator account</SectionLabel>
      ) : null}
    </div>
  );
}