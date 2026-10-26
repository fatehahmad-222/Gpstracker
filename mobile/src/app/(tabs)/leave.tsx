import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import {
  CalendarDays,
  ChevronRight,
  Plus,
  Stethoscope,
  TreePalm,
  Umbrella,
} from "lucide-react-native";
import { Pressable, View } from "react-native";

import { AppText } from "@/components/ui/app-text";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState, ErrorState, PageHeader, ScreenScroll } from "@/components/ui/screen";
import { apiRequest } from "@/lib/api";
import { QUERY_KEYS } from "@/lib/constants";
import { formatDate, titleCase } from "@/lib/format";
import type { Leave } from "@/lib/types";

const typeIcons = {
  casual: Umbrella,
  sick: Stethoscope,
  annual: TreePalm,
} as const;

const statusTone = {
  pending: "warn",
  approved: "ok",
  rejected: "danger",
} as const;

export default function LeaveScreen() {
  const router = useRouter();
  const query = useQuery({
    queryKey: QUERY_KEYS.leaves("mine"),
    queryFn: () => apiRequest<{ rows: Leave[] }>("/api/app/leaves"),
  });

  const rows = query.data?.rows || [];
  const pending = rows.filter((row) => row.status === "pending").length;

  return (
    <ScreenScroll refreshing={query.isRefetching} onRefresh={() => query.refetch()}>
      <PageHeader
        eyebrow="Time off"
        title="My leave"
        subtitle={pending ? `${pending} request${pending === 1 ? "" : "s"} awaiting a decision.` : "Your leave history and requests."}
        right={
          <Button
            size="sm"
            onPress={() => router.push("/leave/new")}
            leftIcon={<Plus size={14} color="#FFFFFF" />}
          >
            Request
          </Button>
        }
      />

      <Card className="mb-4 flex-row gap-3 border-cyan/20 bg-cyan/[0.04]">
        <CalendarDays size={18} color="#22D3EE" />
        <AppText variant="small" className="flex-1">
          Requests are reviewed by your administrator. You can keep working while a
          request is pending.
        </AppText>
      </Card>

      {query.isError ? (
        <ErrorState
          title="Could not load leave"
          message="Check your connection and try again."
          onRetry={() => query.refetch()}
        />
      ) : query.isLoading ? (
        <Card className="items-center py-8">
          <AppText variant="small">Loading your leave…</AppText>
        </Card>
      ) : rows.length ? (
        <View className="gap-3">
          {rows.map((row) => {
            const Icon = typeIcons[row.leave_type] || Umbrella;
            return (
              <Card key={row.id} className="p-4">
                <View className="flex-row items-start gap-3">
                  <View className="h-10 w-10 items-center justify-center rounded-2xl bg-raised">
                    <Icon size={18} color="#8FA6C0" />
                  </View>
                  <View className="flex-1">
                    <View className="flex-row items-center justify-between gap-2">
                      <AppText className="font-semibold">{titleCase(row.leave_type)} leave</AppText>
                      <Badge label={titleCase(row.status)} tone={statusTone[row.status]} dot />
                    </View>
                    <AppText className="mt-1 text-[12px] text-dim">
                      {formatDate(row.from_date, { weekday: "short", month: "short", day: "numeric" })}
                      {row.to_date !== row.from_date
                        ? ` → ${formatDate(row.to_date, { weekday: "short", month: "short", day: "numeric" })}`
                        : ""}
                    </AppText>
                    {row.reason ? (
                      <AppText className="mt-2 text-[11px] leading-5 text-faint" numberOfLines={3}>
                        {row.reason}
                      </AppText>
                    ) : null}
                  </View>
                </View>
              </Card>
            );
          })}
        </View>
      ) : (
        <EmptyState
          icon={<CalendarDays size={28} color="#5E7693" />}
          title="No leave requests"
          message="When you need time off, file a request and it will appear here."
          action={
            <Button onPress={() => router.push("/leave/new")} leftIcon={<Plus size={15} color="#FFFFFF" />}>
              Request leave
            </Button>
          }
        />
      )}

      <Pressable
        onPress={() => router.push("/leave/new")}
        className="mt-4 flex-row items-center justify-between rounded-2xl border border-line bg-surface p-4 active:opacity-80"
      >
        <View className="flex-row items-center gap-3">
          <View className="h-9 w-9 items-center justify-center rounded-xl bg-brand/12">
            <Plus size={17} color="#7CB4FF" />
          </View>
          <View>
            <AppText className="text-[13px] font-semibold">New request</AppText>
            <AppText className="text-[11px] text-faint">Casual, sick or annual leave</AppText>
          </View>
        </View>
        <ChevronRight size={17} color="#5E7693" />
      </Pressable>
    </ScreenScroll>
  );
}
