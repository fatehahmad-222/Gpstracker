"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  MapPin,
  Phone,
  Plus,
} from "lucide-react";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import NewTaskModal from "@/components/dashboard/NewTaskModal";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { GeoBadge, StatusBadge } from "@/components/ui/Badge";
import { Skeleton, SkeletonText } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { MapLoading } from "@/components/map/MapLoading";
import { MAX_HISTORY_POINTS, OFFLINE_AFTER_MS } from "@/lib/constants";
import { cn, formatDateTime, isOnline, timeAgo, todayRange, toDateInputValue } from "@/lib/utils";

const HistoryMap = dynamic(() => import("@/components/map/HistoryMap"), {
  ssr: false,
  loading: () => <MapLoading />,
});

export default function EmployeeProfilePage() {
  const params = useParams();
  const employeeId = params.id;

  const [profile, setProfile] = useState(null);
  const [live, setLive] = useState(null);
  const [tasks, setTasks] = useState(null);
  const [locations, setLocations] = useState(null);
  const [range, setRange] = useState(todayRange());
  const [dateInputs, setDateInputs] = useState(() => ({
    from: toDateInputValue(new Date()),
    to: toDateInputValue(new Date()),
  }));
  const [modalOpen, setModalOpen] = useState(false);
  const [error, setError] = useState(null);
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [truncated, setTruncated] = useState(false);

  useEffect(() => {
    if (!employeeId) return;
    let mounted = true;
    Promise.all([
      supabase.from("profiles").select("id, full_name, role, phone, avatar_url, created_at").eq("id", employeeId).maybeSingle(),
      supabase.from("live_locations").select("*").eq("employee_id", employeeId).maybeSingle(),
      supabase.from("tasks").select("*").eq("employee_id", employeeId).order("created_at", { ascending: false }),
    ]).then(([p, l, t]) => {
      if (!mounted) return;
      if (p.error) setError(p.error.message);
      else setProfile(p.data);
      setLive(l.data ?? null);
      setTasks(t.data ?? []);
      setProfileLoaded(true);
    });
    return () => {
      mounted = false;
    };
  }, [employeeId]);

  const loadHistory = useCallback(
    async (rng) => {
      if (!employeeId) return;
      setLocations(null);
      // Newest-first so the limit keeps the *most recent* fixes; ascending order
      // with a limit would return the oldest ones and drop the live end of the
      // trail on busy days.
      const { data } = await supabase
        .from("locations")
        .select("lat, lng, recorded_at, accuracy")
        .eq("employee_id", employeeId)
        .gte("recorded_at", rng.from)
        .lte("recorded_at", rng.to)
        .order("recorded_at", { ascending: false })
        .limit(MAX_HISTORY_POINTS);
      const rows = data ?? [];
      setTruncated(rows.length === MAX_HISTORY_POINTS);
      // Restore chronological order for the polyline.
      setLocations(rows.slice().reverse());
    },
    [employeeId]
  );

  useEffect(() => {
    loadHistory(range);
  }, [loadHistory, range]);

  function handleDateChange(field, value) {
    let next = { ...dateInputs, [field]: value };

    // An empty or partial date input is not a range — leave the current one
    // alone rather than building an Invalid Date.
    if (!next.from || !next.to) {
      setDateInputs(next);
      return;
    }

    let from = new Date(`${next.from}T00:00:00`);
    let to = new Date(`${next.to}T23:59:59.999`);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      setDateInputs(next);
      return;
    }

    // Picked in reverse — query the span between them and show it that way too,
    // so the inputs never disagree with what's on the map.
    if (from > to) {
      [from, to] = [to, from];
      next = { from: next.to, to: next.from };
    }

    setDateInputs(next);
    setRange({ from: from.toISOString(), to: to.toISOString() });
  }

  const employee = useMemo(() => (profile ? [profile] : []), [profile]);

  if (error) {
    return (
      <EmptyState
        title="Couldn’t load this employee"
        description={error}
        action={
          <Button variant="secondary" href="/dashboard/employees">
            Back to employees
          </Button>
        }
      />
    );
  }

  if (!profile) {
    if (!profileLoaded) {
      return (
        <div className="space-y-4">
          <Skeleton className="h-24" />
          <Skeleton className="h-96" />
        </div>
      );
    }

    return (
      <EmptyState
        title="Employee not found"
        description="This profile no longer exists — the account may have been deleted."
        action={
          <Button variant="secondary" href="/dashboard/employees">
            Back to employees
          </Button>
        }
      />
    );
  }

  const online = isOnline(live?.recorded_at, Date.now(), OFFLINE_AFTER_MS);
  const pointCount = locations?.length ?? 0;
  const activeTasks = (tasks ?? []).filter((t) => t.status === "pending" || t.status === "in_progress");

  return (
    <div className="space-y-4">
      <Link
        href="/dashboard/employees"
        className="inline-flex items-center gap-1.5 text-sm text-ink-dim transition-colors hover:text-ink"
      >
        <ArrowLeft size={15} />
        Employees
      </Link>

      <div className="rounded-card border border-line bg-surface p-5">
        <div className="flex flex-wrap items-center gap-4">
          <Avatar name={profile.full_name} size={56} online={online} />
          <div className="min-w-0 flex-1">
            <h1 className="font-display text-xl font-semibold tracking-tight text-ink">
              {profile.full_name || "Unnamed"}
            </h1>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-dim">
              <span className={cn(online ? "text-accent" : "")}>
                {online ? "Online now" : "Offline"}
              </span>
              {live && <span>last seen {timeAgo(live.recorded_at)}</span>}
              {profile.phone && (
                <span className="inline-flex items-center gap-1">
                  <Phone size={13} />
                  {profile.phone}
                </span>
              )}
              {profile.created_at && (
                <span>member since {formatDateTime(profile.created_at)}</span>
              )}
            </div>
          </div>
          <Button onClick={() => setModalOpen(true)}>
            <Plus size={16} />
            Assign task
          </Button>
        </div>
      </div>

      <div className="overflow-hidden rounded-card border border-line bg-surface">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
          <div className="flex items-center gap-2">
            <CalendarDays size={16} className="text-accent" />
            <h2 className="font-display text-sm font-semibold text-ink">Location history</h2>
            {pointCount > 0 && (
              <span className="font-mono text-xs text-ink-dim">
                {pointCount.toLocaleString()} fix{pointCount === 1 ? "" : "es"}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={dateInputs.from}
              onChange={(e) => handleDateChange("from", e.target.value)}
              className="rounded-field border border-line bg-bg px-3 py-1.5 text-sm text-ink focus:border-accent focus:outline-none"
            />
            <span className="text-ink-dim">→</span>
            <input
              type="date"
              value={dateInputs.to}
              onChange={(e) => handleDateChange("to", e.target.value)}
              className="rounded-field border border-line bg-bg px-3 py-1.5 text-sm text-ink focus:border-accent focus:outline-none"
            />
          </div>
        </div>

        <div className="h-[380px] w-full">
          <HistoryMap
            locations={locations ?? []}
            tasks={tasks ?? []}
            live={live}
            fitKey={`${employeeId}:${range.from}:${range.to}`}
          />
        </div>

        {locations && locations.length === 0 && (
          <div className="px-5 py-4 text-sm text-ink-dim">
            No location fixes recorded in this range — the path will render as
            fixes stream in.
          </div>
        )}

        {truncated && locations && locations.length > 0 && (
          <div className="border-t border-line px-5 py-3 text-xs text-ink-dim">
            Showing the most recent {MAX_HISTORY_POINTS.toLocaleString()} fixes in
            this range. Narrow the dates to see the full path.
          </div>
        )}
      </div>

      <div className="rounded-card border border-line bg-surface">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
          <div className="flex items-center gap-2">
            <ClipboardList size={16} className="text-accent" />
            <h2 className="font-display text-sm font-semibold text-ink">
              Task history
            </h2>
            {activeTasks.length > 0 && (
              <span className="rounded-pill bg-warning/15 px-2 py-0.5 text-xs font-medium text-warning">
                {activeTasks.length} active
              </span>
            )}
          </div>
        </div>

        {!tasks ? (
          <div className="p-5">
            <SkeletonText lines={3} />
          </div>
        ) : tasks.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-ink-dim">
            No tasks assigned yet.
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {tasks.map((task) => (
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
                  {task.status === "completed" ? (
                    <CheckCircle2 size={15} />
                  ) : (
                    <MapPin size={15} />
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-display text-sm font-semibold text-ink">
                      {task.title}
                    </span>
                    <StatusBadge status={task.status} />
                    {task.status === "completed" && (
                      <GeoBadge source={task.completion_source} />
                    )}
                  </div>

                  <div className="mt-1.5 space-y-0.5 text-xs text-ink-dim">
                    <div className="flex items-center gap-1.5">
                      <MapPin size={12} className="shrink-0" />
                      <span className="line-clamp-1">
                        {task.target_address ||
                          `${task.target_lat.toFixed(5)}, ${task.target_lng.toFixed(5)}`}
                      </span>
                      <span className="shrink-0">· {Math.round(task.radius_meters)} m radius</span>
                    </div>
                    <div>
                      Assigned {formatDateTime(task.created_at)}
                      {task.due_at && ` · due ${formatDateTime(task.due_at)}`}
                    </div>
                    {task.status === "completed" && task.completed_at && (
                      <div>
                        Completed {formatDateTime(task.completed_at)}
                        {task.completion_source === "geofence"
                          ? " — reached the target location"
                          : " — closed by admin"}
                      </div>
                    )}
                    {task.status === "cancelled" && (
                      <div>Cancelled by admin</div>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <NewTaskModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        employees={employee}
        defaultEmployeeId={profile.id}
      />
    </div>
  );
}
