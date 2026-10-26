import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Clock3, LogIn, LogOut, Timer } from "lucide-react-native";
import { useState } from "react";
import { Pressable, View } from "react-native";

import { AppText } from "@/components/ui/app-text";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState, ErrorState, PageHeader, ScreenScroll } from "@/components/ui/screen";
import { useNow } from "@/hooks/use-now";
import { apiRequest } from "@/lib/api";
import { QUERY_KEYS } from "@/lib/constants";
import {
  companyToday,
  formatDate,
  formatDuration,
  formatTime,
  shiftDate,
} from "@/lib/format";
import type { MyAttendance } from "@/lib/types";
import { useApp } from "@/providers/app-provider";

export default function AttendanceScreen() {
  const { bootstrap } = useApp();
  const today = companyToday(bootstrap?.company.timezone);
  const [date, setDate] = useState(today);
  const now = useNow(30_000);

  const query = useQuery({
    queryKey: QUERY_KEYS.attendance("me", date),
    queryFn: () => apiRequest<MyAttendance>(`/api/app/attendance?date=${date}`),
  });

  const data = query.data;
  const rows = data?.rows || [];
  const open = data?.open_session;

  const workedSeconds = rows.reduce((total, row) => {
    if (!row.clock_in_at) return total;
    const end = row.clock_out_at ? new Date(row.clock_out_at).getTime() : now;
    return total + Math.max(0, Math.round((end - new Date(row.clock_in_at).getTime()) / 1000));
  }, 0);

  const firstIn = rows.length
    ? [...rows].sort(
        (a, b) => new Date(a.clock_in_at).getTime() - new Date(b.clock_in_at).getTime()
      )[0]
    : null;
  const lastOut = rows
    .filter((row) => row.clock_out_at)
    .sort(
      (a, b) =>
        new Date(b.clock_out_at as string).getTime() -
        new Date(a.clock_out_at as string).getTime()
    )[0];

  const isToday = date === today;

  return (
    <ScreenScroll
      refreshing={query.isRefetching}
      onRefresh={() => query.refetch()}
    >
      <PageHeader
        eyebrow="Time & attendance"
        title="My attendance"
        subtitle="Sessions recorded against your employee profile."
      />

      <View className="mb-4 flex-row items-center justify-between rounded-2xl border border-line bg-surface p-1.5">
        <Pressable
          onPress={() => setDate((value) => shiftDate(value, -1))}
          className="h-9 w-9 items-center justify-center rounded-xl active:bg-raised"
        >
          <ChevronLeft size={18} color="#8FA6C0" />
        </Pressable>
        <View className="items-center">
          <AppText className="text-[13px] font-semibold">
            {isToday ? "Today" : formatDate(date, { weekday: "short", month: "short", day: "numeric" })}
          </AppText>
          <AppText className="text-[10px] text-faint">{date}</AppText>
        </View>
        <Pressable
          onPress={() => setDate((value) => shiftDate(value, 1))}
          disabled={date >= today}
          className="h-9 w-9 items-center justify-center rounded-xl active:bg-raised disabled:opacity-30"
        >
          <ChevronRight size={18} color="#8FA6C0" />
        </Pressable>
      </View>

      {open ? (
        <Card className="mb-3 flex-row items-center gap-3 border-ok/25 bg-ok/[0.05]">
          <View className="h-10 w-10 items-center justify-center rounded-2xl bg-ok/15">
            <Clock3 size={18} color="#34D399" />
          </View>
          <View className="flex-1">
            <AppText className="text-[13px] font-semibold text-ok">Still clocked in</AppText>
            <AppText className="mt-0.5 text-[11px] text-dim">
              Since {formatTime(open.clock_in_at, bootstrap?.company.timezone)}
              {open.source ? ` · ${open.source}` : ""}
            </AppText>
          </View>
          <Badge label="Open" tone="ok" dot />
        </Card>
      ) : null}

      <Card className="p-5">
        <View className="flex-row items-end justify-between">
          <View>
            <AppText variant="tiny">Total time</AppText>
            <AppText className="mt-2 font-display text-[32px] leading-9">
              {formatDuration(workedSeconds)}
            </AppText>
            <AppText className="mt-1 text-[11px] text-faint">
              {rows.length} session{rows.length === 1 ? "" : "s"} · {isToday ? "today" : "that day"}
            </AppText>
          </View>
          <View className="items-end gap-2">
            <View className="flex-row items-center gap-1.5">
              <LogIn size={13} color="#34D399" />
              <AppText className="text-[12px] text-dim">
                {firstIn ? formatTime(firstIn.clock_in_at, bootstrap?.company.timezone) : "—"}
              </AppText>
            </View>
            <View className="flex-row items-center gap-1.5">
              <LogOut size={13} color="#FB7185" />
              <AppText className="text-[12px] text-dim">
                {lastOut?.clock_out_at
                  ? formatTime(lastOut.clock_out_at, bootstrap?.company.timezone)
                  : "Open"}
              </AppText>
            </View>
          </View>
        </View>
      </Card>

      <View className="mt-6">
        <AppText className="mb-3 font-display text-[16px] tracking-[-0.3px]">Sessions</AppText>

        {query.isError ? (
          <ErrorState
            title="Could not load attendance"
            message="Check your connection and try again."
            onRetry={() => query.refetch()}
          />
        ) : query.isLoading ? (
          <Card className="items-center py-8">
            <AppText variant="small">Loading sessions…</AppText>
          </Card>
        ) : rows.length ? (
          <View className="gap-2.5">
            {rows.map((row, index) => {
              const seconds = row.clock_in_at
                ? Math.max(
                    0,
                    Math.round(
                      ((row.clock_out_at ? new Date(row.clock_out_at).getTime() : now) -
                        new Date(row.clock_in_at).getTime()) /
                        1000
                    )
                  )
                : 0;
              return (
                <Card key={row.id} className="flex-row items-center gap-3.5 p-4">
                  <View className="w-8 items-center">
                    <View
                      className={
                        row.clock_out_at
                          ? "h-2.5 w-2.5 rounded-full bg-faint"
                          : "h-2.5 w-2.5 rounded-full bg-ok"
                      }
                    />
                    {index < rows.length - 1 ? <View className="mt-1 h-8 w-px bg-line" /> : null}
                  </View>
                  <View className="flex-1">
                    <View className="flex-row items-center justify-between">
                      <AppText className="text-[13px] font-semibold">
                        {row.clock_out_at ? "Completed session" : "Active session"}
                      </AppText>
                      <AppText className="text-[12px] font-medium text-dim">
                        {formatDuration(seconds)}
                      </AppText>
                    </View>
                    <AppText className="mt-1 text-[11px] text-faint">
                      {formatTime(row.clock_in_at, bootstrap?.company.timezone)}
                      {" → "}
                      {row.clock_out_at
                        ? formatTime(row.clock_out_at, bootstrap?.company.timezone)
                        : "now"}
                      {row.source ? ` · ${row.source.replace(/_/g, " ")}` : ""}
                    </AppText>
                  </View>
                </Card>
              );
            })}
          </View>
        ) : (
          <EmptyState
            icon={<Timer size={28} color="#5E7693" />}
            title="No sessions"
            message={
              isToday
                ? "Start a shift from Home. Attendance is recorded from your field activity."
                : "No attendance was recorded for this day."
            }
          />
        )}
      </View>

      <Card className="mt-4 border-line bg-surface">
        <AppText variant="small">
          Sessions are generated from your shift activity and location check-ins.
          Starting a shift on Home keeps your position available to the team, but
          your attendance record is derived on the server.
        </AppText>
      </Card>
    </ScreenScroll>
  );
}
