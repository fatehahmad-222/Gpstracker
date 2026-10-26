import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";
import {
  CalendarClock,
  Check,
  CheckCircle2,
  ExternalLink,
  MapPin,
  Navigation,
  Play,
  Target,
} from "lucide-react-native";
import { useState } from "react";
import { Alert, Linking, View } from "react-native";

import { MapView } from "@/components/map/map-view";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { AppText } from "@/components/ui/app-text";
import { ErrorState, LoadingState, PageHeader, ScreenScroll } from "@/components/ui/screen";
import { apiRequest, errorMessage } from "@/lib/api";
import { QUERY_KEYS } from "@/lib/constants";
import { formatDate, formatTime, titleCase } from "@/lib/format";
import type { Task, TaskStatus } from "@/lib/types";

const statusTone = {
  pending: "neutral",
  in_progress: "warn",
  completed: "ok",
  cancelled: "danger",
} as const;

export default function TaskDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const query = useQuery({
    queryKey: QUERY_KEYS.task(String(id)),
    queryFn: () => apiRequest<{ row: Task }>(`/api/app/tasks/${id}`),
    enabled: Boolean(id),
  });

  const task = query.data?.row;

  const update = useMutation({
    mutationFn: (status: TaskStatus) =>
      apiRequest<{ row: Task }>(`/api/app/tasks/${id}`, {
        method: "PATCH",
        body: { status },
      }),
    onSuccess: async () => {
      setError(null);
      await queryClient.invalidateQueries({ queryKey: ["tasks"] });
      await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.task(String(id)) });
    },
    onError: (err) => setError(errorMessage(err)),
  });

  const complete = () => {
    Alert.alert(
      "Mark this task complete?",
      "Your operations team will see it as finished from the field app.",
      [
        { text: "Not yet", style: "cancel" },
        {
          text: "Mark complete",
          onPress: () => update.mutate("completed"),
        },
      ]
    );
  };

  if (query.isLoading) return <LoadingState label="Loading task" />;

  if (query.isError || !task) {
    return (
      <ScreenScroll>
        <PageHeader title="Task" back />
        <ErrorState
          title="Task unavailable"
          message={errorMessage(query.error)}
          onRetry={() => query.refetch()}
        />
      </ScreenScroll>
    );
  }

  const overdue =
    task.due_at &&
    task.status !== "completed" &&
    task.status !== "cancelled" &&
    new Date(task.due_at).getTime() < Date.now();
  const hasTarget = task.target_lat != null && task.target_lng != null;

  return (
    <ScreenScroll>
      <PageHeader
        eyebrow="Assigned work"
        title={task.title}
        back
        right={<Badge label={titleCase(task.status)} tone={statusTone[task.status]} dot />}
      />

      {error ? (
        <Card className="mb-4 border-danger/25 bg-danger/[0.06]">
          <AppText className="text-[12px] leading-5 text-danger">{error}</AppText>
        </Card>
      ) : null}

      {hasTarget ? (
        <View className="mb-4 h-52">
          <MapView
            points={[
              {
                id: task.id,
                lat: Number(task.target_lat),
                lng: Number(task.target_lng),
                name: task.target_address || "Task location",
                subtitle: task.radius_meters
                  ? `Target radius ${task.radius_meters}m`
                  : "Assigned location",
              },
            ]}
            initialZoom={15}
          />
        </View>
      ) : null}

      <Card className="gap-4 p-5">
        {task.description ? (
          <AppText className="text-[14px] leading-6 text-dim">{task.description}</AppText>
        ) : (
          <AppText variant="small">No additional instructions were left for this task.</AppText>
        )}

        <View className="h-px bg-line" />

        <View className="flex-row gap-3">
          <View className="h-9 w-9 items-center justify-center rounded-xl bg-raised">
            <CalendarClock size={16} color="#8FA6C0" />
          </View>
          <View className="flex-1">
            <AppText variant="tiny">Due</AppText>
            <AppText className={overdue ? "mt-1 font-medium text-danger" : "mt-1 font-medium"}>
              {task.due_at
                ? `${formatDate(task.due_at, { weekday: "short", month: "short", day: "numeric" })} · ${formatTime(task.due_at)}`
                : "No deadline"}
            </AppText>
            {overdue ? <AppText className="mt-0.5 text-[10px] text-danger">Overdue</AppText> : null}
          </View>
        </View>

        {task.target_address ? (
          <View className="flex-row gap-3">
            <View className="h-9 w-9 items-center justify-center rounded-xl bg-raised">
              <MapPin size={16} color="#8FA6C0" />
            </View>
            <View className="flex-1">
              <AppText variant="tiny">Location</AppText>
              <AppText className="mt-1 font-medium">{task.target_address}</AppText>
              {hasTarget && task.radius_meters ? (
                <AppText className="mt-0.5 text-[10px] text-faint">
                  Arrival radius {task.radius_meters}m
                </AppText>
              ) : null}
            </View>
          </View>
        ) : null}

        {task.completion_source ? (
          <View className="flex-row gap-3">
            <View className="h-9 w-9 items-center justify-center rounded-xl bg-raised">
              <CheckCircle2 size={16} color="#8FA6C0" />
            </View>
            <View className="flex-1">
              <AppText variant="tiny">Completed</AppText>
              <AppText className="mt-1 font-medium">
                {titleCase(task.completion_source)}
                {task.completed_at ? ` · ${formatTime(task.completed_at)}` : ""}
              </AppText>
            </View>
          </View>
        ) : null}
      </Card>

      {hasTarget ? (
        <Button
          variant="secondary"
          className="mt-3"
          leftIcon={<Navigation size={16} color="#E8F1FB" />}
          onPress={() =>
            Linking.openURL(
              `https://www.google.com/maps/dir/?api=1&destination=${task.target_lat},${task.target_lng}`
            )
          }
          rightIcon={<ExternalLink size={14} color="#5E7693" />}
        >
          Open directions
        </Button>
      ) : null}

      {task.status === "pending" ? (
        <Button
          size="lg"
          className="mt-4"
          loading={update.isPending}
          onPress={() => update.mutate("in_progress")}
          leftIcon={<Play size={16} color="#FFFFFF" fill="#FFFFFF" />}
        >
          Start task
        </Button>
      ) : null}

      {task.status === "pending" || task.status === "in_progress" ? (
        <Button
          size="lg"
          variant={task.status === "pending" ? "secondary" : "primary"}
          className="mt-2.5"
          loading={update.isPending}
          onPress={complete}
          leftIcon={<Check size={17} color={task.status === "pending" ? "#E8F1FB" : "#FFFFFF"} />}
        >
          Mark complete
        </Button>
      ) : task.status === "completed" ? (
        <Card className="mt-4 flex-row items-center gap-3 border-ok/20 bg-ok/[0.05]">
          <CheckCircle2 size={20} color="#34D399" />
          <AppText variant="small" className="flex-1">
            This task is complete. Nice work.
          </AppText>
        </Card>
      ) : (
        <Card className="mt-4 flex-row items-center gap-3 border-danger/20 bg-danger/[0.04]">
          <Target size={19} color="#FB7185" />
          <AppText variant="small" className="flex-1">
            This task was cancelled by an administrator.
          </AppText>
        </Card>
      )}
    </ScreenScroll>
  );
}
