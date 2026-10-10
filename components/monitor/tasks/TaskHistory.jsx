"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ClipboardList, MapPin, Search } from "lucide-react";

import { api, qs } from "@/lib/monitor/client";
import { Card, StatusPill, CountPill, NameAvatar } from "@/components/monitor/primitives";
import { ErrorState, EmptyState, TableSkeleton } from "@/components/monitor/states";
import { inputClass } from "@/components/monitor/config/fields";
import { cn, formatDateTime } from "@/lib/utils";
import {
  COMPLETION_SOURCE_META,
  TASK_STATUSES,
  countTasks,
  isFinished,
} from "@/lib/monitor/fieldTasks";

export function TaskHistory() {
  const [employees, setEmployees] = useState([]);
  const [employeeErr, setEmployeeErr] = useState(null);
  const [selected, setSelected] = useState(null);
  const [search, setSearch] = useState("");
  const [tasks, setTasks] = useState([]);
  const [tasksErr, setTasksErr] = useState(null);
  const [tasksLoading, setTasksLoading] = useState(false);

  useEffect(() => {
    api
      .get("/api/monitor/employees?page_size=200&include_archived=1")
      .then((data) => {
        const rows = data?.rows || [];
        setEmployees(rows);
        setSelected(rows[0] || null);
      })
      .catch((err) => setEmployeeErr(err.message || "Could not load employees"));
  }, []);

  const loadTasks = useCallback(async (emp) => {
    if (!emp) return;
    setTasksLoading(true);
    setTasksErr(null);
    try {
      const data = await api.get(`/api/monitor/tasks${qs({ employee_id: emp.id })}`);
      setTasks(data?.rows || []);
    } catch (err) {
      setTasksErr(err.message || "Could not load tasks");
    } finally {
      setTasksLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTasks(selected);
  }, [selected, loadTasks]);

  const filteredEmployees = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return employees;
    return employees.filter((e) => {
      const name = String(e.name || "").toLowerCase();
      const code = String(e.emp_code || e.code || "").toLowerCase();
      return name.includes(term) || code.includes(term);
    });
  }, [employees, search]);

  const counts = useMemo(() => countTasks(tasks), [tasks]);

  return (
    <div className="grid gap-4 lg:grid-cols-[320px,1fr]">
      <Card title="Employees" subtitle="Select an employee to view their history" bodyClassName="p-0">
        <div className="flex items-center gap-2 border-b border-line px-3 py-2">
          <Search size={14} className="text-ink-dim" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name or code"
            className={cn(inputClass(), "h-8 px-2 text-[12px]")}
            aria-label="Search employees"
          />
        </div>
        <div className="max-h-[70vh] overflow-y-auto">
          {employeeErr ? (
            <div className="px-3 py-2 text-[12px] text-crit">{employeeErr}</div>
          ) : filteredEmployees.length === 0 ? (
            <div className="px-3 py-3 text-[12px] text-ink-dim">No employees found.</div>
          ) : (
            <ul className="divide-y divide-line">
              {filteredEmployees.map((e) => {
                const isSel = selected?.id === e.id;
                return (
                  <li key={e.id}>
                    <button
                      type="button"
                      onClick={() => setSelected(e)}
                      className={cn(
                        "flex w-full items-center gap-2 px-3 py-2 text-left transition",
                        isSel ? "bg-accent/10" : "hover:bg-surface-2"
                      )}
                    >
                      <NameAvatar name={e.name} size={28} />
                      <div className="min-w-0">
                        <div className="truncate text-[13px] font-medium text-ink">{e.name}</div>
                        <div className="truncate text-[11px] text-ink-dim">
                          {e.emp_code || e.code || ""}
                          {e.status === "inactive" ? " · inactive" : ""}
                          {e.deleted_at ? " · archived" : ""}
                        </div>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </Card>

      <Card
        title={selected ? selected.name : "Task history"}
        subtitle={selected ? (selected.emp_code || selected.code || "") : "No employee selected"}
        actions={
          <div className="flex flex-wrap items-center gap-1.5">
            <CountPill tone="neutral">Total {counts.total}</CountPill>
            <CountPill tone="neutral">Open {counts.open}</CountPill>
            <CountPill tone="brand">Completed {counts.completed}</CountPill>
            <CountPill tone="neutral">Cancelled {counts.cancelled}</CountPill>
          </div>
        }
      >
        {tasksLoading ? (
          <TableSkeleton />
        ) : tasksErr ? (
          <ErrorState title="Could not load tasks" hint={tasksErr} onRetry={() => loadTasks(selected)} />
        ) : tasks.length === 0 ? (
          <EmptyState title="No tasks assigned yet" hint="This employee has no task history in this company." />
        ) : (
          <ul className="divide-y divide-line">
            {[...tasks]
              .sort((a, b) => {
                const ast = TASK_STATUSES.indexOf(a.status);
                const bst = TASK_STATUSES.indexOf(b.status);
                if (ast !== bst) return ast - bst;
                if (isFinished(a.status) && isFinished(b.status)) {
                  const ad = a.completed_at ? new Date(a.completed_at).getTime() : 0;
                  const bd = b.completed_at ? new Date(b.completed_at).getTime() : 0;
                  return bd - ad;
                }
                const ac = a.created_at ? new Date(a.created_at).getTime() : 0;
                const bc = b.created_at ? new Date(b.created_at).getTime() : 0;
                return bc - ac;
              })
              .map((task) => {
                const open = task.status === "pending" || task.status === "in_progress";
                const compLabel = COMPLETION_SOURCE_META[task.completion_source]?.label;
                return (
                  <li key={task.id} className="flex flex-wrap items-start gap-3 px-5 py-4">
                    <div
                      className={cn(
                        "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border",
                        task.status === "completed"
                          ? "border-accent/25 bg-accent/10 text-accent"
                          : task.status === "in_progress"
                          ? "border-info/25 bg-info/10 text-info"
                          : task.status === "pending"
                          ? "border-warning/25 bg-warning/10 text-warning"
                          : "border-line bg-surface-2 text-ink-dim"
                      )}
                    >
                      <ClipboardList size={15} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-display text-sm font-semibold text-ink">{task.title}</span>
                        <StatusPill
                          status={open ? (task.status === "in_progress" ? "info" : "neutral") : task.status === "completed" ? "ok" : "neutral"}
                          label={task.status.replace("_", " ")}
                        />
                        {task.status === "completed" && compLabel ? (
                          <CountPill tone="neutral">{compLabel === "reached the target location" ? "Geofence" : "Manual"}</CountPill>
                        ) : null}
                      </div>
                      <div className="mt-1.5 space-y-0.5 text-xs text-ink-dim">
                        <div className="flex items-center gap-1.5">
                          <MapPin size={12} className="shrink-0" />
                          <span className="line-clamp-1">
                            {task.target_address ||
                              (task.target_lat != null && task.target_lng != null
                                ? `${task.target_lat.toFixed(5)}, ${task.target_lng.toFixed(5)}`
                                : "No pin")}
                          </span>
                          {task.radius_meters != null ? (
                            <span className="shrink-0">· {Math.round(task.radius_meters)} m radius</span>
                          ) : null}
                        </div>
                        <div>
                          Assigned {formatDateTime(task.created_at)}
                          {task.due_at && ` · due ${formatDateTime(task.due_at)}`}
                        </div>
                        {task.status === "completed" && task.completed_at && (
                          <div>
                            Completed {formatDateTime(task.completed_at)}
                            {compLabel ? `  ${compLabel}` : ""}
                          </div>
                        )}
                        {task.status === "cancelled" && <div>Cancelled by admin</div>}
                      </div>
                    </div>
                  </li>
                );
              })}
          </ul>
        )}
      </Card>
    </div>
  );
}
