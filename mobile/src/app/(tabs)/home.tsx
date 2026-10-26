import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import {
  ArrowUpRight,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Clock3,
  MapPin,
  Play,
  ShieldCheck,
  Square,
  Timer,
  UserRound,
} from "lucide-react-native";
import { Alert, Pressable, View } from "react-native";

import { SyncStrip } from "@/components/sync-strip";
import { TaskCard } from "@/components/task-card";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { ScreenScroll, ErrorState, EmptyState } from "@/components/ui/screen";
import { SectionHeader } from "@/components/ui/section-header";
import { StatTile } from "@/components/ui/stat-tile";
import { AppText } from "@/components/ui/app-text";
import { useNetworkStatus } from "@/hooks/use-network-status";
import { useNow } from "@/hooks/use-now";
import { apiRequest } from "@/lib/api";
import { QUERY_KEYS } from "@/lib/constants";
import {
  companyToday,
  firstName,
  formatDuration,
  formatTime,
  greeting,
  percent,
  shiftWindow,
  titleCase,
} from "@/lib/format";
import type { Dashboard, MyAttendance, Task } from "@/lib/types";
import { useApp } from "@/providers/app-provider";
import { useAuth } from "@/providers/auth-provider";
import { useTracking } from "@/providers/tracking-provider";

export default function HomeScreen() {
  const { isAdmin } = useApp();
  return isAdmin ? <AdminHome /> : <EmployeeHome />;
}

function EmployeeHome() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const online = useNetworkStatus();
  const now = useNow(30_000);
  const { bootstrap } = useApp();
  const {
    active,
    start,
    stop,
    error: trackingError,
    clearError,
    permission,
  } = useTracking();

  const timezone = bootstrap?.company.timezone;
  const date = companyToday(timezone);

  const attendanceQuery = useQuery({
    queryKey: QUERY_KEYS.attendance("me", date),
    queryFn: () => apiRequest<MyAttendance>(`/api/app/attendance?date=${date}`),
    refetchInterval: 60_000,
  });

  const tasksQuery = useQuery({
    queryKey: QUERY_KEYS.tasks("mine-open"),
    queryFn: () => apiRequest<{ rows: Task[] }>("/api/app/tasks?status=open"),
    refetchInterval: 45_000,
  });

  const attendance = attendanceQuery.data;
  const openSession = attendance?.open_session;
  const elapsed = openSession?.clock_in_at
    ? Math.max(0, Math.round((now - new Date(openSession.clock_in_at).getTime()) / 1000))
    : 0;
  const openTasks = tasksQuery.data?.rows || [];
  const nextTask = openTasks[0];

  const beginShift = async () => {
    const started = await start();
    if (started) await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.attendance("me", date) });
  };

  const endShift = () => {
    Alert.alert(
      "End this shift?",
      "Location tracking will stop and the records already collected will be uploaded.",
      [
        { text: "Keep working", style: "cancel" },
        {
          text: "End shift",
          style: "destructive",
          onPress: async () => {
            await stop();
            await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.attendance("me", date) });
          },
        },
      ]
    );
  };

  const refresh = () => {
    attendanceQuery.refetch();
    tasksQuery.refetch();
  };

  return (
    <ScreenScroll refreshing={attendanceQuery.isRefetching} onRefresh={refresh}>
      <View className="mb-5 mt-2 flex-row items-center justify-between">
        <View className="flex-1">
          <AppText variant="tiny">{online ? "Connected" : "Offline mode"}</AppText>
          <AppText variant="heading" className="mt-1">
            {greeting()}, {firstName(bootstrap?.employee?.name)}
          </AppText>
          <AppText variant="muted" className="mt-1">
            {bootstrap?.employee?.designation_id ? "Field operations" : "Let's make today count"}
          </AppText>
        </View>
        <Pressable onPress={() => router.push("/(tabs)/more")} className="active:opacity-80">
          <Avatar name={bootstrap?.employee?.name} uri={bootstrap?.employee?.photo_url} size={46} />
        </Pressable>
      </View>

      {trackingError ? (
        <Pressable
          onPress={clearError}
          className="mb-4 flex-row items-start gap-2 rounded-2xl border border-danger/25 bg-danger/[0.07] p-3.5"
        >
          <MapPin size={16} color="#FB7185" />
          <AppText className="flex-1 text-[12px] leading-5 text-danger">{trackingError}</AppText>
        </Pressable>
      ) : null}

      <Card
        className={
          active
            ? "overflow-hidden rounded-[30px] border-ok/30 bg-ok/[0.06] p-5"
            : "overflow-hidden rounded-[30px] p-5"
        }
      >
        <View className="flex-row items-start justify-between">
          <View>
            <View className="flex-row items-center gap-2">
              <View
                className={
                  active
                    ? "h-2 w-2 rounded-full bg-ok"
                    : "h-2 w-2 rounded-full bg-faint"
                }
              />
              <AppText
                className={
                  active
                    ? "text-[11px] font-semibold uppercase tracking-[1.3px] text-ok"
                    : "text-[11px] font-semibold uppercase tracking-[1.3px] text-faint"
                }
              >
                {active ? "Shift active" : openSession ? "Clocked in" : "Off shift"}
              </AppText>
            </View>
            <AppText className="mt-3 font-display text-[34px] leading-10 tracking-[-1px]">
              {active ? (elapsed ? formatDuration(elapsed) : "Tracking") : "Ready to roll"}
            </AppText>
            <AppText variant="small" className="mt-1">
              {active
                ? "Your position is shared with your operations team"
                : openSession
                  ? `Clocked in at ${formatTime(openSession.clock_in_at, timezone)}`
                  : shiftWindow(
                      bootstrap?.employee?.shift_start,
                      bootstrap?.employee?.shift_end
                    )}
            </AppText>
          </View>
          <View
            className={
              active
                ? "h-14 w-14 items-center justify-center rounded-2xl bg-ok/15"
                : "h-14 w-14 items-center justify-center rounded-2xl bg-brand/12"
            }
          >
            {active ? (
              <ShieldCheck size={26} color="#34D399" />
            ) : (
              <Clock3 size={26} color="#7CB4FF" />
            )}
          </View>
        </View>

        {active ? (
          <Button
            variant="danger"
            size="lg"
            className="mt-5"
            onPress={endShift}
            leftIcon={<Square size={16} color="#FB7185" fill="#FB7185" />}
          >
            End shift
          </Button>
        ) : (
          <Button
            size="lg"
            className="mt-5"
            onPress={beginShift}
            leftIcon={<Play size={17} color="#FFFFFF" fill="#FFFFFF" />}
          >
            Start shift & tracking
          </Button>
        )}

        {!active && !permission.foreground ? (
          <Pressable
            onPress={() => router.push("/(tabs)/more")}
            className="mt-3 flex-row items-center justify-center gap-1"
          >
            <AppText className="text-[11px] text-warn">Location permission needs attention</AppText>
            <ChevronRight size={12} color="#FBBF24" />
          </Pressable>
        ) : null}
      </Card>

      <View className="mt-3">
        <SyncStrip />
      </View>

      <View className="mt-6 flex-row gap-2.5">
        <QuickAction
          icon={<Timer size={18} color="#7CB4FF" />}
          label="Attendance"
          hint={openSession ? "Clocked in" : "Today's log"}
          onPress={() => router.push("/(tabs)/attendance")}
        />
        <QuickAction
          icon={<CalendarDays size={18} color="#22D3EE" />}
          label="Leave"
          hint="Request time off"
          onPress={() => router.push("/(tabs)/leave")}
        />
      </View>

      <View className="mt-7">
        <SectionHeader
          title="Next task"
          actionLabel={openTasks.length > 1 ? `All ${openTasks.length}` : "View all"}
          href="/(tabs)/tasks"
        />
        {tasksQuery.isError ? (
          <ErrorState
            title="Tasks unavailable"
            message="Your assignments could not be loaded."
            onRetry={() => tasksQuery.refetch()}
          />
        ) : nextTask ? (
          <TaskCard task={nextTask} />
        ) : (
          <EmptyState
            icon={<CheckCircle2 size={30} color="#34D399" />}
            title="Clear for now"
            message="No open tasks are assigned to you."
            action={
              <Button variant="secondary" size="sm" onPress={() => router.push("/(tabs)/tasks")}>
                Task history
              </Button>
            }
          />
        )}
      </View>

      <View className="mt-7">
        <SectionHeader title="Today" />
        <Card className="gap-4 p-4">
          <View className="flex-row items-center justify-between">
            <View className="flex-row items-center gap-3">
              <View className="h-9 w-9 items-center justify-center rounded-xl bg-raised">
                <UserRound size={16} color="#8FA6C0" />
              </View>
              <View>
                <AppText className="text-[13px] font-semibold">
                  {attendance?.is_open ? "Present today" : "Not clocked in"}
                </AppText>
                <AppText className="text-[11px] text-faint">
                  {attendance?.rows?.length
                    ? `${attendance.rows.length} session${attendance.rows.length === 1 ? "" : "s"} logged`
                    : "No session logged yet"}
                </AppText>
              </View>
            </View>
            <Badge
              label={attendance?.is_open ? "Open" : "Scheduled"}
              tone={attendance?.is_open ? "ok" : "neutral"}
              dot
            />
          </View>
          <View className="h-px bg-line" />
          <View className="flex-row items-center justify-between">
            <View>
              <AppText variant="tiny">Shift window</AppText>
              <AppText className="mt-1 text-[13px] font-medium">
                {shiftWindow(bootstrap?.employee?.shift_start, bootstrap?.employee?.shift_end)}
              </AppText>
            </View>
            <View className="items-end">
              <AppText variant="tiny">Employee code</AppText>
              <AppText className="mt-1 text-[13px] font-medium">
                {bootstrap?.employee?.emp_code || "—"}
              </AppText>
            </View>
          </View>
        </Card>
      </View>

      <View className="mt-7">
        <SectionHeader title="How tracking works" />
        <Card className="flex-row gap-3 border-brand/20 bg-brand/[0.04]">
          <ClipboardList size={19} color="#7CB4FF" />
          <AppText variant="small" className="flex-1">
            Only a shift you start records location. It stops when you end the
            shift, and unsynced points wait safely on this phone.
          </AppText>
        </Card>
      </View>
    </ScreenScroll>
  );
}

function QuickAction({
  icon,
  label,
  hint,
  onPress,
}: {
  icon: React.ReactNode;
  label: string;
  hint: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      className="flex-1 rounded-3xl border border-line bg-surface p-4 active:opacity-80"
    >
      <View className="mb-3 h-9 w-9 items-center justify-center rounded-xl bg-raised">
        {icon}
      </View>
      <AppText className="text-[13px] font-semibold">{label}</AppText>
      <AppText className="mt-0.5 text-[11px] text-faint">{hint}</AppText>
    </Pressable>
  );
}

function AdminHome() {
  const router = useRouter();
  const { bootstrap, isAdmin } = useApp();
  const { session } = useAuth();
  const date = companyToday(bootstrap?.company.timezone);

  const dashboardQuery = useQuery({
    queryKey: QUERY_KEYS.dashboard(date),
    queryFn: () => apiRequest<Dashboard>(`/api/monitor/dashboard?date=${date}`),
    enabled: isAdmin,
    refetchInterval: 60_000,
  });

  const dashboard = dashboardQuery.data;
  const kpi = (key: string) => dashboard?.kpis.find((item) => item.key === key);
  const departments = dashboard?.departments || [];
  const leaders = departments.slice(0, 4);
  const openSessions = dashboard?.open_sessions?.length || 0;
  const name = session?.user.email?.split("@")[0]?.replace(/[._-]/g, " ") || "Operations";

  return (
    <ScreenScroll
      refreshing={dashboardQuery.isRefetching}
      onRefresh={() => dashboardQuery.refetch()}
    >
      <View className="mb-5 mt-2 flex-row items-center justify-between">
        <View>
          <AppText variant="tiny">Command overview</AppText>
          <AppText variant="heading" className="mt-1 capitalize">{name}</AppText>
          <AppText variant="muted" className="mt-1">
            {dashboard?.date ? `Live for ${dashboard.date}` : "Pulling today's picture"}
          </AppText>
        </View>
        <Pressable onPress={() => router.push("/(tabs)/more")} className="active:opacity-80">
          <Avatar name={name} size={46} />
        </Pressable>
      </View>

      {dashboardQuery.isError ? (
        <ErrorState
          title="Dashboard unavailable"
          message="The live overview could not be loaded."
          onRetry={() => dashboardQuery.refetch()}
        />
      ) : (
        <>
          <View className="flex-row gap-2.5">
            <StatTile
              label="Present now"
              value={kpi("present")?.value ?? "—"}
              hint={`${openSessions} still clocked in`}
              accent="green"
            />
            <StatTile
              label="Attendance"
              value={kpi("attendance_rate")?.value ?? "—"}
              hint={`${percent(dashboard?.rate.pct)} today`}
              accent="blue"
            />
          </View>
          <View className="mt-2.5 flex-row gap-2.5">
            <StatTile
              label="Open alerts"
              value={kpi("violations")?.value ?? "—"}
              hint={kpi("violations")?.hint || "Nothing unresolved"}
              accent={Number(kpi("violations")?.value) ? "red" : "slate"}
            />
            <StatTile
              label="Leaves pending"
              value={kpi("leaves")?.value ?? "—"}
              hint="Awaiting a decision"
              accent={Number(kpi("leaves")?.value) ? "amber" : "slate"}
            />
          </View>

          <View className="mt-6">
            <SectionHeader title="Needs your attention" />
            <View className="gap-2.5">
              <ActionRow
                icon={<CalendarDays size={18} color="#FBBF24" />}
                title={`${kpi("leaves")?.value ?? 0} leave request${Number(kpi("leaves")?.value) === 1 ? "" : "s"}`}
                subtitle="Approve or decline time off"
                tone="warn"
                onPress={() => router.push("/approvals")}
              />
              <ActionRow
                icon={<ShieldCheck size={18} color="#FB7185" />}
                title={`${kpi("violations")?.value ?? 0} unresolved alert${Number(kpi("violations")?.value) === 1 ? "" : "s"}`}
                subtitle="Review device and policy signals"
                tone="danger"
                onPress={() => router.push("/(tabs)/alerts")}
              />
            </View>
          </View>

          <View className="mt-7">
            <SectionHeader
              title="Attendance by team"
              actionLabel="Team"
              href="/(tabs)/team"
            />
            <Card className="gap-4">
              {leaders.length ? (
                leaders.map((team) => {
                  const pct = team.total ? Math.round((team.present / team.total) * 100) : 0;
                  return (
                    <View key={team.id}>
                      <View className="mb-1.5 flex-row items-center justify-between">
                        <AppText className="text-[13px] font-medium">{team.name}</AppText>
                        <AppText className="text-[11px] text-dim">
                          {team.present}/{team.total} · {pct}%
                        </AppText>
                      </View>
                      <Progress
                        value={pct}
                        tone={pct >= 90 ? "ok" : pct >= 65 ? "brand" : "warn"}
                      />
                    </View>
                  );
                })
              ) : (
                <AppText variant="small">No department data for today yet.</AppText>
              )}
            </Card>
          </View>

          <View className="mt-7">
            <SectionHeader
              title="Live field"
              actionLabel="Open map"
              href="/(tabs)/map"
            />
            <Pressable
              onPress={() => router.push("/(tabs)/map")}
              className="flex-row items-center justify-between rounded-3xl border border-line bg-surface p-4 active:opacity-80"
            >
              <View className="flex-row items-center gap-3">
                <View className="h-11 w-11 items-center justify-center rounded-2xl bg-cyan/10">
                  <MapPin size={20} color="#22D3EE" />
                </View>
                <View>
                  <AppText className="font-semibold">Field positions</AppText>
                  <AppText className="mt-0.5 text-[11px] text-faint">
                    {openSessions} active shift{openSessions === 1 ? "" : "s"} · refreshed every 15s
                  </AppText>
                </View>
              </View>
              <ArrowUpRight size={18} color="#5E7693" />
            </Pressable>
          </View>

          <View className="mt-7 rounded-3xl border border-line bg-surface p-4">
            <AppText variant="tiny" className="mb-3">Headcount</AppText>
            <View className="flex-row items-end justify-between">
              <AppText className="font-display text-[30px] leading-9">
                {kpi("headcount")?.value ?? "—"}
              </AppText>
              <View className="items-end">
                <AppText className="text-[12px] text-dim">
                  {kpi("absent")?.value ?? 0} absent · {kpi("late")?.value ?? 0} late
                </AppText>
                <AppText className="mt-1 text-[10px] uppercase tracking-[1.2px] text-faint">
                  Active workforce
                </AppText>
              </View>
            </View>
          </View>
        </>
      )}
    </ScreenScroll>
  );
}

function ActionRow({
  icon,
  title,
  subtitle,
  tone,
  onPress,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  tone: "warn" | "danger";
  onPress: () => void;
}) {
  const background = tone === "warn" ? "bg-warn/10" : "bg-danger/10";
  return (
    <Pressable
      onPress={onPress}
      className="flex-row items-center gap-3 rounded-2xl border border-line bg-surface p-3.5 active:opacity-80"
    >
      <View className={`h-10 w-10 items-center justify-center rounded-xl ${background}`}>
        {icon}
      </View>
      <View className="flex-1">
        <AppText className="text-[13px] font-semibold">{title}</AppText>
        <AppText className="mt-0.5 text-[11px] text-faint">{subtitle}</AppText>
      </View>
      <ChevronRight size={17} color="#5E7693" />
    </Pressable>
  );
}
