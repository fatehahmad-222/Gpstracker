"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Ban, Plus, RefreshCcw, Users } from "lucide-react";
import { useLiveOverview } from "@/hooks/useLiveOverview";
import { useAuth } from "@/components/providers/AuthProvider";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { SkeletonCard } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { supabase } from "@/lib/supabaseClient";
import { cn, isOnline, timeAgo } from "@/lib/utils";
import { OFFLINE_AFTER_MS } from "@/lib/constants";
import AddEmployeeModal from "@/components/dashboard/AddEmployeeModal";

export default function EmployeesPage() {
  const { profiles, positions, tasks, loading, now } = useLiveOverview();
  const { profile: admin } = useAuth();
  const [addOpen, setAddOpen] = useState(false);
  const [showDeactivated, setShowDeactivated] = useState(false);
  const [inactive, setInactive] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [busy, setBusy] = useState(false);

  const loadInactive = async () => {
    const { data } = await supabase
      .from("profiles")
      .select("id, full_name, role, phone, avatar_url, created_at, is_active")
      .eq("role", "employee")
      .eq("is_active", false)
      .order("full_name");
    setInactive(data ?? []);
  };

  const visible = useMemo(() => {
    const base = showDeactivated ? [...profiles, ...(inactive ?? [])] : profiles;
    return base.sort((a, b) =>
      (a.full_name || "").localeCompare(b.full_name || "")
    );
  }, [profiles, inactive, showDeactivated]);

  const toggleShowDeactivated = async () => {
    const next = !showDeactivated;
    setShowDeactivated(next);
    if (next) await loadInactive();
  };

  async function setActiveState(profile, active) {
    setBusy(true);
    try {
      const { error } = await supabase
        .from("profiles")
        .update({ is_active: active })
        .eq("id", profile.id);
      if (error) throw error;
      if (showDeactivated) await loadInactive();
    } catch (err) {
      console.error("Failed to update employee:", err.message);
    } finally {
      setBusy(false);
      setPendingDelete(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-semibold tracking-tight text-ink">
            Employees
          </h1>
          <p className="mt-0.5 text-sm text-ink-dim">
            Everyone on the field team. Click any employee for their location
            history and tasks.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" onClick={toggleShowDeactivated}>
            {showDeactivated ? "Hide deactivated" : "Show deactivated"}
          </Button>
          <Button onClick={() => setAddOpen(true)}>
            <Plus size={16} />
            Add employee
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      ) : visible.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No employees yet"
          description="Add team members with the Add employee button, or let them create accounts themselves."
          action={
            <Button onClick={() => setAddOpen(true)}>
              <Plus size={16} />
              Add employee
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((profile) => {
            const pos = positions[profile.id] ?? null;
            const active = profile.is_active !== false;
            const online = active && isOnline(pos?.recorded_at, now, OFFLINE_AFTER_MS);
            const activeTasks = tasks.filter((t) => t.employee_id === profile.id);
            const isSelf = admin?.id === profile.id;
            return (
              <div
                key={profile.id}
                className={cn(
                  "group relative rounded-card border bg-surface p-4 transition-colors",
                  active ? "border-line hover:border-accent/40" : "border-line opacity-75"
                )}
              >
                <Link
                  href={`/dashboard/employees/${profile.id}`}
                  aria-label={`Open ${profile.full_name || "employee"} profile`}
                  className="absolute inset-0 z-0 rounded-card"
                />

                <div className="relative flex items-center gap-3">
                  <Avatar name={profile.full_name} size={44} online={online} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate font-display text-sm font-semibold text-ink">
                        {profile.full_name || "Unnamed"}
                      </span>
                      <ArrowUpRight
                        size={14}
                        className="shrink-0 text-ink-dim opacity-0 transition-opacity group-hover:opacity-100"
                      />
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 text-xs text-ink-dim">
                      {active ? (
                        <>
                          <span
                            className={cn(
                              "h-1.5 w-1.5 rounded-full",
                              online ? "bg-accent" : "bg-ink-dim"
                            )}
                          />
                          {online ? "Online" : "Offline"}
                          {pos && <span>· {timeAgo(pos.recorded_at, now)}</span>}
                        </>
                      ) : (
                        <span className="font-medium uppercase tracking-wide text-ink-dim">
                          Deactivated
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="relative mt-3 flex items-center justify-between rounded-lg bg-surface-2 px-3 py-2 text-xs">
                  <span className="text-ink-dim">
                    {activeTasks.length > 0
                      ? `Active task: ${activeTasks[0].title}`
                      : "No active task"}
                  </span>
                  <span className="font-mono text-accent">{activeTasks.length}</span>
                </div>

                <div className="relative mt-3 flex justify-end gap-2">
                  {active && !isSelf ? (
                    <Button
                      variant="danger"
                      size="xs"
                      onClick={() => setPendingDelete(profile)}
                    >
                      <Ban size={13} /> Deactivate
                    </Button>
                  ) : !active ? (
                    <Button
                      variant="secondary"
                      size="xs"
                      disabled={busy}
                      onClick={() => setActiveState(profile, true)}
                    >
                      <RefreshCcw size={13} /> Restore
                    </Button>
                  ) : isSelf ? (
                    <span className="text-[11px] font-medium uppercase tracking-wide text-ink-dim">
                      You
                    </span>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <AddEmployeeModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onCreated={() => {}}
      />

      <Modal
        open={!!pendingDelete}
        onClose={() => !busy && setPendingDelete(null)}
        title="Deactivate employee"
      >
        <div className="space-y-4 p-5">
          <p className="text-sm text-ink">
            Deactivate{" "}
            <span className="font-semibold">{pendingDelete?.full_name || "this employee"}</span>?
          </p>
          <p className="text-sm text-ink-dim">
            Their account can no longer sign in and they stop appearing on the
            live map. Location history and assigned tasks are kept so you can
            restore them any time.
          </p>
          <div className="flex justify-end gap-2 border-t border-line pt-4">
            <Button variant="secondary" onClick={() => setPendingDelete(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              disabled={busy}
              onClick={() => setActiveState(pendingDelete, false)}
            >
              Deactivate
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
