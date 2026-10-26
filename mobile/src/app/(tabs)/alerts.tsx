import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronUp,
  Fingerprint,
  ShieldAlert,
} from "lucide-react-native";
import { useState } from "react";
import { Alert, Pressable, View } from "react-native";

import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { AppText } from "@/components/ui/app-text";
import { EmptyState, ErrorState, PageHeader, ScreenScroll } from "@/components/ui/screen";
import { Segmented } from "@/components/ui/segmented";
import { StatTile } from "@/components/ui/stat-tile";
import { apiRequest, errorMessage } from "@/lib/api";
import { QUERY_KEYS } from "@/lib/constants";
import { timeAgo, titleCase } from "@/lib/format";
import type { AlertItem, AlertsResponse } from "@/lib/types";

const filters = [
  { key: "unresolved", label: "Unresolved" },
  { key: "all", label: "All" },
];

const severityTone = {
  critical: "danger",
  high: "danger",
  medium: "warn",
  low: "neutral",
} as const;

export default function AlertsScreen() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState("unresolved");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const query = useQuery({
    queryKey: [...QUERY_KEYS.alerts, filter],
    queryFn: () =>
      apiRequest<AlertsResponse>(`/api/monitor/alerts?status=${filter === "all" ? "all" : "unresolved"}&page_size=50`),
    refetchInterval: 45_000,
  });

  const mutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: "acknowledged" | "resolved" }) =>
      apiRequest(`/api/monitor/alerts/${id}`, {
        method: "PATCH",
        body: { status },
      }),
    onSuccess: async () => {
      setError(null);
      await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.alerts });
      await queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (err) => setError(errorMessage(err)),
  });

  const rows: AlertItem[] = query.data?.rows || [];
  const summary = query.data?.summary;

  const act = (alert: AlertItem) => {
    const target = alert.status === "open" ? "acknowledged" : "resolved";
    const verb = target === "acknowledged" ? "Acknowledge" : "Resolve";
    Alert.alert(
      `${verb} alert?`,
      `${alert.label} · ${alert.name}`,
      [
        { text: "Cancel", style: "cancel" },
        { text: verb, onPress: () => mutation.mutate({ id: alert.id, status: target }) },
      ]
    );
  };

  return (
    <ScreenScroll
      refreshing={query.isRefetching}
      onRefresh={() => query.refetch()}
    >
      <PageHeader
        eyebrow="Trust & safety"
        title="Alerts"
        subtitle="Device and policy signals that need a human decision."
        right={
          <View className="h-10 w-10 items-center justify-center rounded-2xl bg-danger/10">
            <ShieldAlert size={19} color="#FB7185" />
          </View>
        }
      />

      <View className="flex-row gap-2.5">
        <StatTile
          label="Unresolved"
          value={summary?.unresolved ?? 0}
          hint={`${summary?.total ?? 0} in window`}
          accent={summary?.unresolved ? "red" : "slate"}
        />
        <StatTile
          label="Critical + high"
          value={(summary?.critical ?? 0) + (summary?.high ?? 0)}
          hint="Worst severity first"
          accent={(summary?.critical ?? 0) + (summary?.high ?? 0) ? "amber" : "slate"}
        />
        <StatTile
          label="Resolved"
          value={summary?.resolved ?? 0}
          hint="Closed in window"
          accent="green"
        />
      </View>

      <View className="mt-4">
        <Segmented options={filters} value={filter} onChange={setFilter} scroll={false} />
      </View>

      {error ? (
        <Card className="mt-3 border-danger/25 bg-danger/[0.06]">
          <AppText className="text-[12px] leading-5 text-danger">{error}</AppText>
        </Card>
      ) : null}

      <View className="mt-4 gap-2.5">
        {query.isError ? (
          <ErrorState
            title="Could not load alerts"
            message="The triage queue is unavailable."
            onRetry={() => query.refetch()}
          />
        ) : query.isLoading ? (
          <Card className="items-center py-8">
            <AppText variant="small">Loading alerts…</AppText>
          </Card>
        ) : rows.length ? (
          rows.map((alert) => {
            const busy = mutation.isPending && mutation.variables?.id === alert.id;
            const isOpen = expanded === alert.id;
            return (
              <Card key={alert.id} className="p-4">
                <Pressable
                  onPress={() => setExpanded(isOpen ? null : alert.id)}
                  className="active:opacity-80"
                >
                  <View className="flex-row items-start gap-3">
                    <Avatar name={alert.name} uri={alert.photo_url} size={38} />
                    <View className="flex-1">
                      <View className="flex-row items-center justify-between gap-2">
                        <AppText className="flex-1 font-semibold" numberOfLines={1}>
                          {alert.label}
                        </AppText>
                        <Badge
                          label={titleCase(alert.severity)}
                          tone={severityTone[alert.severity] || "neutral"}
                          dot
                        />
                      </View>
                      <AppText className="mt-0.5 text-[11px] text-faint" numberOfLines={1}>
                        {alert.name}
                        {alert.emp_code ? ` · ${alert.emp_code}` : ""}
                        {alert.department_name ? ` · ${alert.department_name}` : ""}
                      </AppText>
                      <View className="mt-2 flex-row items-center gap-2">
                        <Badge
                          label={titleCase(alert.status)}
                          tone={
                            alert.status === "open"
                              ? "danger"
                              : alert.status === "acknowledged"
                                ? "warn"
                                : "ok"
                          }
                        />
                        <AppText className="text-[10px] text-faint">
                          {timeAgo(alert.occurred_at)}
                        </AppText>
                        <View className="flex-1" />
                        {isOpen ? (
                          <ChevronUp size={15} color="#5E7693" />
                        ) : (
                          <ChevronDown size={15} color="#5E7693" />
                        )}
                      </View>
                    </View>
                  </View>
                </Pressable>

                {isOpen ? (
                  <View className="mt-3 rounded-2xl border border-line bg-canvas p-3">
                    <View className="flex-row items-center gap-2">
                      <Fingerprint size={13} color="#8FA6C0" />
                      <AppText className="text-[10px] uppercase tracking-[1px] text-faint">
                        {alert.category} · {alert.type.replace(/_/g, " ")}
                      </AppText>
                    </View>
                    <AppText className="mt-2 text-[11px] leading-5 text-dim">
                      This signal was raised from device or shift evidence. Acknowledge
                      it once you have reviewed the context; resolve it when the issue
                      is closed.
                    </AppText>
                  </View>
                ) : null}

                {alert.status !== "resolved" ? (
                  <View className="mt-3 flex-row gap-2">
                    <Button
                      size="sm"
                      variant={alert.status === "open" ? "secondary" : "success"}
                      className="flex-1"
                      disabled={busy}
                      loading={busy}
                      onPress={() => act(alert)}
                      leftIcon={
                        alert.status === "open" ? (
                          <AlertTriangle size={14} color="#E8F1FB" />
                        ) : (
                          <Check size={14} color="#34D399" />
                        )
                      }
                    >
                      {alert.status === "open" ? "Acknowledge" : "Resolve"}
                    </Button>
                  </View>
                ) : null}
              </Card>
            );
          })
        ) : (
          <EmptyState
            icon={<Check size={28} color="#34D399" />}
            title={filter === "unresolved" ? "All clear" : "No alerts"}
            message={
              filter === "unresolved"
                ? "Nothing is waiting for triage in the current window."
                : "No device or policy signals were raised."
            }
          />
        )}
      </View>
    </ScreenScroll>
  );
}
