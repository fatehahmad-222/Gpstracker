"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Smartphone, Plus, ShieldOff, Copy, Check, X, AlertTriangle } from "lucide-react";

import { api, qs } from "@/lib/monitor/client";
import { TOKEN_STATUS, tokenStatus, relativeTime } from "@/lib/monitor/devices";
import { Card, DataTable, StatusPill, columnDef, CountPill } from "@/components/monitor/primitives";
import { ErrorState, EmptyState, TableSkeleton } from "@/components/monitor/states";
import { Field, inputClass } from "@/components/monitor/config/fields";
import { cn } from "@/lib/utils";

/**
 * Device enrolment.
 *
 * This screen exists because the ingestion endpoint cannot be reached without it.
 * A phone authenticates to /api/track/ingest with a bearer token, and that token
 * is issued here - so before this page existed, the entire write path for every
 * monitor screen was only reachable with curl.
 *
 * The plaintext token is displayed exactly once, immediately after enrolment, and
 * cannot be retrieved afterwards because only its sha256 hash is stored. The UI
 * treats that as the important detail: it says so plainly and offers a copy button
 * rather than pretending the value can be looked up later.
 */

function statusMeta(row) {
  return TOKEN_STATUS[tokenStatus(row)];
}

// ---------------------------------------------------------------------------
// One-time token reveal
// ---------------------------------------------------------------------------

function TokenReveal({ issued, onDismiss }) {
  const [copied, setCopied] = useState(false);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(issued.token);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Clipboard access can be refused; the token is on screen either way, so
      // failing quietly is better than alarming the user about a copy they may
      // not have needed.
    }
  }, [issued.token]);

  return (
    <div className="rounded-tile border border-brand/40 bg-brand-tint p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
          <div>
            <h3 className="text-[13.5px] font-semibold text-ink">Copy this token now</h3>
            <p className="mt-0.5 text-[11.5px] text-ink-dim">
              Only a hash of it is stored, so this is the one and only time it can be shown. If it
              is lost, revoke this device and enrol it again.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="shrink-0 rounded-pill p-1 text-ink-dim transition hover:bg-surface hover:text-ink"
          aria-label="Dismiss"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-3 flex items-center gap-2">
        <code className="min-w-0 flex-1 overflow-x-auto rounded-tile border border-line bg-surface px-3 py-2 font-mono text-[12px] text-ink">
          {issued.token}
        </code>
        <button
          type="button"
          onClick={copy}
          className="flex shrink-0 items-center gap-1.5 rounded-pill bg-brand px-3.5 py-2 text-[12.5px] font-semibold text-white transition hover:bg-brand-strong"
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>

      <p className="mt-2 font-mono text-[11px] text-ink-dim">
        POST /api/track/ingest &nbsp; Authorization: Bearer &lt;token&gt;
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Enrolment form
// ---------------------------------------------------------------------------

function EnrolForm({ employees, onEnrolled }) {
  const [values, setValues] = useState({ employee_id: "", device_id: "", label: "" });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const set = (key) => (event) => setValues((v) => ({ ...v, [key]: event.target.value }));

  const submit = async (event) => {
    event.preventDefault();
    setError(null);

    if (!values.employee_id) {
      setError("Choose the employee this handset belongs to.");
      return;
    }
    if (!values.device_id.trim()) {
      setError("Enter a device id. Use the Android device id or a serial, not a nickname.");
      return;
    }

    setBusy(true);
    try {
      const result = await api.post("/api/monitor/device-tokens", {
        employee_id: values.employee_id,
        device_id: values.device_id.trim(),
        label: values.label.trim() || null,
      });
      setValues({ employee_id: "", device_id: "", label: "" });
      onEnrolled(result);
    } catch (err) {
      setError(err.message || "Could not enrol that device");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <Field label="Employee" required>
        <select value={values.employee_id} onChange={set("employee_id")} className={inputClass()}>
          <option value="">Select an employee</option>
          {employees.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name} ({e.emp_code})
            </option>
          ))}
        </select>
      </Field>

      <Field
        label="Device id"
        required
        hint="Stable per handset. Re-enrolling the same id replaces the old token."
      >
        <input
          value={values.device_id}
          onChange={set("device_id")}
          className={inputClass(Boolean(error) && !values.device_id.trim())}
          placeholder="e.g. R58M30ABCDE"
          autoComplete="off"
        />
      </Field>

      <Field label="Label" hint="Optional. Something a supervisor will recognise.">
        <input
          value={values.label}
          onChange={set("label")}
          className={inputClass()}
          placeholder="e.g. Sales - Ahmed's Pixel"
        />
      </Field>

      {error ? <p className="text-[11.5px] text-danger">{error}</p> : null}

      <button
        type="submit"
        disabled={busy}
        className="flex items-center gap-1.5 rounded-pill bg-brand px-4 py-2 text-[12.5px] font-semibold text-white transition hover:bg-brand-strong disabled:opacity-60"
      >
        <Plus className="h-3.5 w-3.5" />
        {busy ? "Enrolling" : "Enrol device"}
      </button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Manager
// ---------------------------------------------------------------------------

export function DeviceManager() {
  const [rows, setRows] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [issued, setIssued] = useState(null);
  const [revoking, setRevoking] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get("/api/monitor/device-tokens");
      setRows(data.rows || []);
    } catch (err) {
      setError(err.message || "Could not load devices");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    // Reuses the org-units endpoint rather than adding a second employee source.
    api
      .get(`/api/monitor/org-units${qs({ kind: "employees", page_size: 200, status: "active" })}`)
      .then((data) => setEmployees(data.rows || []))
      .catch(() => setEmployees([]));
  }, []);

  const revoke = useCallback(
    async (row) => {
      setRevoking(row.id);
      try {
        await api.patch(`/api/monitor/device-tokens/${row.id}`, { action: "revoke" });
        await load();
      } catch (err) {
        setError(err.message || "Could not revoke that device");
      } finally {
        setRevoking(null);
      }
    },
    [load]
  );

  const columns = useMemo(
    () => [
      columnDef({
        id: "name",
        header: "Employee",
        size: 220,
        cell: ({ row }) => (
          <div className="min-w-0">
            <div className="truncate font-medium text-ink">{row.original.name || "Unknown"}</div>
            <div className="truncate text-[11px] text-ink-dim">{row.original.emp_code || "-"}</div>
          </div>
        ),
      }),
      columnDef({
        id: "device_id",
        accessorKey: "device_id",
        header: "Device",
        size: 200,
        cell: ({ row }) => (
          <div className="min-w-0">
            <div className="truncate font-mono text-[12px] text-ink">{row.original.device_id}</div>
            {row.original.label ? (
              <div className="truncate text-[11px] text-ink-dim">{row.original.label}</div>
            ) : null}
          </div>
        ),
      }),
      columnDef({
        id: "active",
        header: "Status",
        size: 120,
        cell: ({ row }) => {
          const meta = statusMeta(row.original);
          return <StatusPill status={meta.status} label={meta.label} />;
        },
      }),
      columnDef({
        id: "last_used_at",
        accessorKey: "last_used_at",
        header: "Last sync",
        size: 110,
        cell: ({ getValue }) => (
          <span className="text-[12px] text-ink-dim">{relativeTime(getValue())}</span>
        ),
      }),
      columnDef({
        id: "actions",
        header: "",
        size: 60,
        cell: ({ row }) => {
          if (tokenStatus(row.original) !== "active") {
            return <span className="text-[11px] text-ink-dim">-</span>;
          }
          return (
            <button
              type="button"
              onClick={() => revoke(row.original)}
              disabled={revoking === row.original.id}
              title="Revoke this device"
              className={cn(
                "rounded-pill p-1.5 text-ink-dim transition",
                "hover:bg-danger-tint hover:text-danger disabled:opacity-50"
              )}
            >
              <ShieldOff className="h-4 w-4" />
            </button>
          );
        },
      }),
    ],
    [revoke, revoking]
  );

  const active = rows.filter((r) => tokenStatus(r) === "active").length;

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[19px] font-semibold text-ink">Devices</h1>
          <p className="mt-0.5 text-[12px] text-ink-dim">
            Handsets allowed to report location and device signals into this company.
          </p>
        </div>
        <CountPill tone="brand">{active} active</CountPill>
      </header>

      {issued ? (
        <TokenReveal issued={issued} onDismiss={() => setIssued(null)} />
      ) : null}

      {error ? <ErrorState title="Could not load devices" hint={error} onRetry={load} /> : null}

      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <Card title="Enrolled devices" subtitle="Revoking takes effect on the device's next sync.">
          {loading ? (
            <TableSkeleton rows={6} cols={5} />
          ) : rows.length === 0 ? (
            <EmptyState
              icon={Smartphone}
              title="No devices enrolled"
              hint="Without a device nothing reports a location, so the map, the dashboard and the alert queue stay empty."
            />
          ) : (
            <DataTable columns={columns} rows={rows} rowKey="id" />
          )}
        </Card>

        <Card title="Enrol a device" subtitle="Issues a token the handset presents on every sync.">
          <EnrolForm
            employees={employees}
            onEnrolled={(result) => {
              setIssued(result);
              load();
            }}
          />
        </Card>
      </div>
    </div>
  );
}