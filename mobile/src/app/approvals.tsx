import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Stethoscope, TreePalm, Umbrella, X } from "lucide-react-native";
import { useState } from "react";
import { Alert, View } from "react-native";

import { AppText } from "@/components/ui/app-text";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState, ErrorState, PageHeader, ScreenScroll } from "@/components/ui/screen";
import { Segmented } from "@/components/ui/segmented";
import { apiRequest, errorMessage } from "@/lib/api";
import { QUERY_KEYS } from "@/lib/constants";
import { formatDate, titleCase } from "@/lib/format";
import type { Leave } from "@/lib/types";

const typeIcons = {
  casual: Umbrella,
  sick: Stethoscope,
  annual: TreePalm,
} as const;

const filters = [
  { key: "pending", label: "Pending" },
  { key: "all", label: "All" },
];

export default function ApprovalsScreen() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState("pending");
  const [error, setError] = useState<string | null>(null);

  const query = useQuery({
    queryKey: QUERY_KEYS.leaves("staff"),
    queryFn: () => apiRequest<{ is_admin: boolean; rows: Leave[] }>("/api/monitor/leaves"),
  });

  const mutation = useMutation({
    mutationFn: ({ id, action }: { id: string; action: "approve" | "reject" }) =>
      apiRequest<{ row: Leave }>(`/api/monitor/leaves/${id}`, {
        method: "PATCH",
        body: { action },
      }),
    onSuccess: async () => {
      setError(null);
      await queryClient.invalidateQueries({ queryKey: ["leaves"] });
      await queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (err) => setError(errorMessage(err)),
  });

  const all = query.data?.rows || [];
  const rows = filter === "pending" ? all.filter((row) => row.status === "pending") : all;
  const pending = all.filter((row) => row.status === "pending").length;

  const decide = (leave: Leave, action: "approve" | "reject") => {
    const verb = action === "approve" ? "Approve" : "Reject";
    Alert.alert(
      `${verb} leave?`,
      `${leave.employee_name || "This employee"} · ${titleCase(leave.leave_type)} leave, ${leave.from_date} to ${leave.to_date}.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: verb,
          style: action === "reject" ? "destructive" : "default",
          onPress: () => mutation.mutate({ id: leave.id, action }),
        },
      ]
    );
  };

  return (
    <ScreenScroll
      refreshing={query.isRefetching}
      onRefresh={() => query.refetch()}
    >
      <PageHeader
        eyebrow="People operations"
        title="Leave approvals"
        subtitle={
          pending
            ? `${pending} request${pending === 1 ? "" : "s"} need a decision.`
            : "Every request has been decided."
        }
        back
      />

      <Segmented
        options={filters.map((item) => ({
          ...item,
          count: item.key === "pending" ? pending : all.length,
        }))}
        value={filter}
        onChange={setFilter}
        scroll={false}
      />

      {error ? (
        <Card className="mt-3 border-danger/25 bg-danger/[0.06]">
          <AppText className="text-[12px] leading-5 text-danger">{error}</AppText>
        </Card>
      ) : null}

      {query.isError ? (
        <ErrorState
          title="Could not load requests"
          message="Check your connection and try again."
          onRetry={() => query.refetch()}
        />
      ) : query.isLoading ? (
        <Card className="mt-4 items-center py-8">
          <AppText variant="small">Loading leave requests…</AppText>
        </Card>
      ) : rows.length ? (
        <View className="mt-4 gap-3">
          {rows.map((leave) => {
            const Icon = typeIcons[leave.leave_type] || Umbrella;
            const busy =
              mutation.isPending && mutation.variables?.id === leave.id;
            return (
              <Card key={leave.id} className="p-4">
                <View className="flex-row items-start gap-3">
                  <View className="h-10 w-10 items-center justify-center rounded-2xl bg-raised">
                    <Icon size={18} color="#8FA6C0" />
                  </View>
                  <View className="flex-1">
                    <View className="flex-row items-center justify-between gap-2">
                      <AppText className="font-semibold" numberOfLines={1}>
                        {leave.employee_name || "Employee"}
                      </AppText>
                      <Badge
                        label={titleCase(leave.status)}
                        tone={
                          leave.status === "pending"
                            ? "warn"
                            : leave.status === "approved"
                              ? "ok"
                              : "danger"
                        }
                        dot
                      />
                    </View>
                    <AppText className="mt-0.5 text-[11px] text-faint">
                      {leave.employee_code ? `${leave.employee_code} · ` : ""}
                      {titleCase(leave.leave_type)} leave
                    </AppText>
                    <AppText className="mt-1 text-[12px] text-dim">
                      {formatDate(leave.from_date, {
                        weekday: "short",
                        month: "short",
                        day: "numeric",
                      })}
                      {leave.to_date !== leave.from_date
                        ? ` → ${formatDate(leave.to_date, {
                            weekday: "short",
                            month: "short",
                            day: "numeric",
                          })}`
                        : ""}
                    </AppText>
                    {leave.reason ? (
                      <AppText className="mt-2 text-[11px] leading-5 text-faint">
                        {leave.reason}
                      </AppText>
                    ) : null}
                  </View>
                </View>

                {leave.status === "pending" ? (
                  <View className="mt-4 flex-row gap-2">
                    <Button
                      size="sm"
                      variant="danger"
                      className="flex-1"
                      disabled={busy}
                      loading={busy && mutation.variables?.action === "reject"}
                      onPress={() => decide(leave, "reject")}
                      leftIcon={<X size={14} color="#FB7185" />}
                    >
                      Reject
                    </Button>
                    <Button
                      size="sm"
                      variant="success"
                      className="flex-1"
                      disabled={busy}
                      loading={busy && mutation.variables?.action === "approve"}
                      onPress={() => decide(leave, "approve")}
                      leftIcon={<Check size={14} color="#34D399" />}
                    >
                      Approve
                    </Button>
                  </View>
                ) : null}
              </Card>
            );
          })}
        </View>
      ) : (
        <EmptyState
          icon={<Check size={28} color="#34D399" />}
          title={filter === "pending" ? "Queue is clear" : "No leave requests"}
          message={
            filter === "pending"
              ? "No leave request is waiting for a decision."
              : "Leave requests from your team will appear here."
          }
        />
      )}
    </ScreenScroll>
  );
}
