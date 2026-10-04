"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Archive,
  ArchiveRestore,
  Download,
  ExternalLink,
  KeyRound,
  Loader2,
  Pencil,
  Plus,
  Search,
  Upload,
  UserPlus,
  Users,
  X,
} from "lucide-react";

import { api, qs, ApiError } from "@/lib/monitor/client";
import { Card, StatusPill, CountPill, DataTable, columnDef, NameAvatar, YesNoPill } from "@/components/monitor/primitives";
import { ErrorState } from "@/components/monitor/states";
import { EmployeeForm } from "./EmployeeForm";
import { ImportReport } from "./ImportReport";
import { PasswordDialog } from "./PasswordDialog";
import AddEmployeeModal from "@/components/dashboard/AddEmployeeModal";
import { useQueryState } from "@/hooks/monitor/useQueryState";
import { cn } from "@/lib/utils";

/**
 * Employee Management (spec 5).
 *
 * One screen for the directory: search, filters, add/edit, archive/restore,
 * app-password reset and CSV import/export. Filters live in the URL so a
 * filtered view can be shared or bookmarked.
 *
 * This screen also absorbed the console's old employee cards when /monitor was
 * folded into /dashboard. That merge had to reconcile two different employee
 * identities rather than just two lists: the monitor keys people by `employees.id`
 * and the console by `profiles.id`, so an HR row exists before, or without, a
 * sign-in account. `profile_id` is the join, and both abilities hang off it --
 * "Sign-in account" creates the missing half, and the name links to the console's
 * own location/task history once it exists.
 */
export function EmployeeManager() {
  // Filters live in the URL so a filtered view can be shared or bookmarked.
  const { values: filters, setParam, setMany, reset } = useQueryState({
    q: "",
    department_id: "",
    designation_id: "",
    status: "",
    geofencing: "",
    archived: "",
  });

  const { q: query, department_id: department, designation_id: designation, status, geofencing, archived: showArchived } = filters;

  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [departments, setDepartments] = useState([]);
  const [designations, setDesignations] = useState([]);
  const [geofences, setGeofences] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState(query || "");
  const [editing, setEditing] = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [passwordFor, setPasswordFor] = useState(null);
  const [accountFor, setAccountFor] = useState(null);
  const [showImport, setShowImport] = useState(false);
  const [notice, setNotice] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get(
        `/api/monitor/employees${qs({
          q: query,
          department_id: department,
          designation_id: designation,
          status,
          geofencing,
          include_archived: showArchived ? "1" : "",
          page_size: 200,
        })}`
      );
      setRows(data.rows || []);
      setTotal(data.total ?? 0);
    } catch (err) {
      setError(err.message || "Could not load employees");
    } finally {
      setLoading(false);
    }
  }, [query, department, designation, status, geofencing, showArchived]);

  useEffect(() => {
    load();
  }, [load]);

  // Lookups for the filters, the form and the export/import dialogs.
  useEffect(() => {
    api.get(`/api/monitor/org-units${qs({ kind: "departments" })}`).then((d) => setDepartments(d.rows || [])).catch(() => {});
    api.get(`/api/monitor/org-units${qs({ kind: "designations" })}`).then((d) => setDesignations(d.rows || [])).catch(() => {});
    api.get("/api/monitor/geofences?page_size=200").then((d) => setGeofences(d.rows || [])).catch(() => {});
  }, []);

  // Debounced so typing does not fire a request per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => {
      if ((search || "") !== (query || "")) setParam("q", search);
    }, 350);
    return () => clearTimeout(timer);
  }, [search, query, setParam]);

  // Keep the box in step with Back/forward navigation.
  useEffect(() => {
    setSearch(query || "");
  }, [query]);

  const archive = useCallback(
    async (row) => {
      const restoring = Boolean(row.deleted_at);
      const confirmed = window.confirm(
        restoring
          ? `Restore ${row.name}? They will appear in pickers again.`
          : `Archive ${row.name}?\n\nTheir attendance history is kept, but they will be hidden from lists and pickers.`
      );
      if (!confirmed) return;

      try {
        await api.delete(`/api/monitor/employees/${row.id}${restoring ? "?restore=1" : ""}`);
        setNotice({
          message: restoring ? `${row.name} was restored.` : `${row.name} was archived.`,
        });
        load();
      } catch (err) {
        setNotice({ tone: "warn", message: err.message || "Could not update this employee" });
      }
    },
    [load]
  );

  const openEditor = useCallback(
    async (row) => {
      // The list returns a summary row that omits CNIC, address, hire date and
      // the rest. Patching from that row would blank every omitted column, so
      // the full record is always loaded before the form is opened.
      if (!row?.id) {
        setEditing({});
        return;
      }

      setLoadingDetail(true);
      try {
        const data = await api.get(`/api/monitor/employees/${row.id}`);
        setEditing(data.employee);
      } catch (err) {
        setNotice({ tone: "warn", message: err.message || "Could not open this employee" });
      } finally {
        setLoadingDetail(false);
      }
    },
    []
  );

  const columns = useMemo(
    () => [
      columnDef({
        id: "name",
        accessorKey: "name",
        header: "Employee",
        size: 240,
        cell: ({ row }) => {
          const person = row.original;
          return (
            <div className="flex min-w-0 items-center gap-2">
              <NameAvatar name={person.name} size={26} />
              <div className="min-w-0">
                {person.profile_id ? (
                  // The console's detail view is keyed by profile id, not by the
                  // HR id this table is built from.
                  <Link
                    href={`/dashboard/employees/${person.profile_id}`}
                    className="flex min-w-0 items-center gap-1 hover:underline"
                  >
                    <span className="truncate font-medium text-ink">{person.name}</span>
                    <ExternalLink size={12} className="shrink-0 text-ink-dim" />
                  </Link>
                ) : (
                  <span className="truncate font-medium text-ink">{person.name}</span>
                )}
                <div className="truncate font-mono text-[11px] text-ink-dim">{person.emp_code}</div>
              </div>
            </div>
          );
        },
      }),
      columnDef({
        id: "department_name",
        accessorKey: "department_name",
        header: "Department",
        size: 150,
        cell: ({ getValue }) => <span className="truncate text-ink-dim">{getValue() || "—"}</span>,
      }),
      columnDef({
        id: "designation_name",
        accessorKey: "designation_name",
        header: "Designation",
        size: 150,
        cell: ({ getValue }) => <span className="truncate text-ink-dim">{getValue() || "—"}</span>,
      }),
      columnDef({
        id: "shift_label",
        accessorKey: "shift_label",
        header: "Shift",
        size: 120,
        cell: ({ getValue }) => <span className="font-mono text-[11.5px] text-ink-dim">{getValue()}</span>,
      }),
      columnDef({
        id: "phone",
        accessorKey: "phone",
        header: "Contact",
        size: 140,
        cell: ({ getValue }) => <span className="font-mono text-[11.5px] text-ink-dim">{getValue() || "—"}</span>,
      }),
      columnDef({
        id: "geofencing_enabled",
        accessorKey: "geofencing_enabled",
        header: "Geo-fencing",
        size: 120,
        cell: ({ getValue }) => <YesNoPill value={getValue()} yesLabel="On" noLabel="Off" />,
      }),
      columnDef({
        id: "status",
        accessorKey: "status",
        header: "Status",
        size: 120,
        cell: ({ row }) =>
          row.original.is_archived ? (
            <StatusPill status="inactive" label="Archived" />
          ) : (
            <StatusPill
              status={row.original.status === "active" ? "active" : "inactive"}
              label={row.original.status === "active" ? "Active" : "Inactive"}
            />
          ),
      }),
      columnDef({
        id: "actions",
        header: "",
        size: 160,
        enableSorting: false,
        cell: ({ row }) => (
          <div className="flex justify-end gap-1">
            {row.original.profile_id ? null : (
              <IconAction
                label={`Create a sign-in account for ${row.original.name}`}
                onClick={() => setAccountFor(row.original)}
                icon={UserPlus}
              />
            )}
            <IconAction
              label={`Reset app password for ${row.original.name}`}
              onClick={() => setPasswordFor(row.original)}
              icon={KeyRound}
            />
            <IconAction
              label={`Edit ${row.original.name}`}
              onClick={() => openEditor(row.original)}
              icon={Pencil}
            />
            <IconAction
              label={row.original.is_archived ? `Restore ${row.original.name}` : `Archive ${row.original.name}`}
              onClick={() => archive(row.original)}
              icon={row.original.is_archived ? ArchiveRestore : Archive}
              danger={!row.original.is_archived}
            />
          </div>
        ),
      }),
    ],
    [archive, openEditor, setAccountFor]
  );

  const exportHref = `/api/monitor/employees/export${qs({
    q: query,
    department_id: department,
    designation_id: designation,
    status,
    geofencing,
    include_archived: showArchived ? "1" : "",
  })}`;

  const hasFilters =
    Boolean(query || department || designation || status || geofencing || showArchived);

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="h-7 w-1.5 rounded-full bg-teal" aria-hidden="true" />
          <div>
            <h1 className="text-xl font-semibold text-ink">Employees</h1>
            <p className="mt-0.5 text-[13px] text-ink-dim">
              The company directory: job details, shifts, pay and app access.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <CountPill tone="neutral">{total} {total === 1 ? "employee" : "employees"}</CountPill>
          <a
            href={exportHref}
            className="flex items-center gap-1.5 rounded-pill border border-line bg-surface px-3 py-1.5 text-[12.5px] font-semibold text-ink-dim transition hover:border-brand/40 hover:text-ink"
          >
            <Download size={14} />
            Export CSV
          </a>
          <button
            type="button"
            onClick={() => setShowImport(true)}
            className="flex items-center gap-1.5 rounded-pill border border-line bg-surface px-3 py-1.5 text-[12.5px] font-semibold text-ink-dim transition hover:border-brand/40 hover:text-ink"
          >
            <Upload size={14} />
            Import CSV
          </button>
          <button
            type="button"
            onClick={() => setEditing({})}
            className="flex items-center gap-1.5 rounded-pill bg-brand px-3.5 py-1.5 text-[12.5px] font-semibold text-white transition hover:bg-brand-strong"
          >
            <Plus size={14} />
            Add employee
          </button>
        </div>
      </header>

      {loadingDetail ? (
        <div
          role="status"
          className="flex items-center gap-2 rounded-tile border border-line bg-surface px-3 py-2 text-[12.5px] text-ink-dim"
        >
          <Loader2 size={14} className="animate-spin" aria-hidden="true" />
          Loading the full record…
        </div>
      ) : null}

      {notice ? (
        <div
          role="status"
          className={cn(
            "rounded-tile border px-3 py-2 text-[12.5px]",
            notice.tone === "warn" ? "border-high/40 bg-high-tint text-high" : "border-brand/40 bg-brand-tint text-brand"
          )}
        >
          {notice.message}
        </div>
      ) : null}

      <Card bodyClassName="p-3">
        <div className="flex flex-wrap items-end gap-2">
          <label className="min-w-[200px] flex-1">
            <span className="sr-only">Search employees</span>
            <div className="relative">
              <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-dim" aria-hidden="true" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name, ID or phone"
                className="w-full rounded-lg border border-line bg-surface py-1.5 pl-8 pr-3 text-[12.5px] text-ink outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/40"
              />
            </div>
          </label>

          <FilterSelect
            label="Department"
            value={department}
            onChange={(v) => setParam("department_id", v)}
            options={departments}
          />
          <FilterSelect
            label="Designation"
            value={designation}
            onChange={(v) => setParam("designation_id", v)}
            options={designations}
          />

          <FilterSelect
            label="Status"
            value={status}
            onChange={(v) => setParam("status", v)}
            options={[
              { id: "active", name: "Active" },
              { id: "inactive", name: "Inactive" },
            ]}
          />

          <FilterSelect
            label="Geo-fencing"
            value={geofencing}
            onChange={(v) => setParam("geofencing", v)}
            options={[
              { id: "on", name: "On" },
              { id: "off", name: "Off" },
            ]}
          />

          <label className="flex h-[34px] cursor-pointer items-center gap-2 rounded-lg border border-line bg-surface px-2.5 text-[12px] text-ink-dim">
            <input
              type="checkbox"
              checked={Boolean(showArchived)}
              onChange={(e) => setParam("archived", e.target.checked ? "1" : "")}
              className="h-3.5 w-3.5 accent-[rgb(var(--brand))]"
            />
            Archived
          </label>

          {hasFilters ? (
            <button
              type="button"
              onClick={() => {
                setSearch("");
                reset();
              }}
              className="flex h-[34px] items-center gap-1 rounded-lg px-2 text-[12px] font-semibold text-ink-dim transition hover:text-ink"
            >
              <X size={12} />
              Clear
            </button>
          ) : null}
        </div>
      </Card>

      {editing ? (
        <EmployeeForm
          employee={editing}
          departments={departments}
          designations={designations}
          geofences={geofences}
          onCancel={() => setEditing(null)}
          onSaved={(message) => {
            setEditing(null);
            setNotice({ message });
            load();
          }}
        />
      ) : null}

      {showImport ? (
        <ImportReport
          onClose={() => setShowImport(false)}
          onImported={() => load()}
        />
      ) : null}

      {passwordFor ? (
        <PasswordDialog
          employee={passwordFor}
          onClose={() => setPasswordFor(null)}
          onReset={(message) => {
            setPasswordFor(null);
            setNotice({ message });
          }}
        />
      ) : null}

      {accountFor ? (
        <AddEmployeeModal
          open
          onClose={() => setAccountFor(null)}
          onCreated={() => {
            setAccountFor(null);
            setNotice({
              message: `Sign-in account created for ${accountFor.name}. Share the temporary password with them.`,
            });
            load();
          }}
          defaults={{
            employee_id: accountFor.id,
            full_name: accountFor.name,
            email: accountFor.email || "",
            phone: accountFor.phone || "",
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
            onRowClick={(row) => setEditing(row.original)}
            empty={{
              title: hasFilters ? "No employees match these filters" : "No employees yet",
              hint: hasFilters
                ? "Try clearing a filter or searching for something else."
                : "Add your first employee, or import a CSV to bring a whole team in at once.",
              icon: Users,
              action: hasFilters ? null : (
                <button
                  type="button"
                  onClick={() => setEditing({})}
                  className="rounded-pill bg-brand px-3 py-1.5 text-[12px] font-semibold text-white"
                >
                  Add employee
                </button>
              ),
            }}
            caption="Employees"
          />
        )}
      </Card>
    </div>
  );
}

function IconAction({ label, onClick, icon: Icon, danger = false }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      title={label}
      aria-label={label}
      className={cn(
        "rounded-lg p-1.5 transition focus-visible:outline-none focus-visible:ring-2",
        danger
          ? "text-ink-dim hover:bg-crit-tint hover:text-crit focus-visible:ring-crit"
          : "text-ink-dim hover:bg-surface-2 hover:text-ink focus-visible:ring-brand"
      )}
    >
      <Icon size={13} />
    </button>
  );
}

function FilterSelect({ label, value, onChange, options }) {
  return (
    <label className="block">
      <span className="sr-only">{label}</span>
      <select
        value={value || ""}
        onChange={(e) => onChange(e.target.value)}
        className="h-[34px] rounded-lg border border-line bg-surface px-2.5 text-[12.5px] text-ink outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/40"
      >
        <option value="">{label}: All</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
    </label>
  );
}