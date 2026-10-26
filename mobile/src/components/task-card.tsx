import { useRouter } from "expo-router";
import { CalendarClock, ChevronRight, MapPin } from "lucide-react-native";
import { Pressable, View } from "react-native";

import { formatDate, formatTime, titleCase } from "@/lib/format";
import type { Task } from "@/lib/types";
import { AppText } from "./ui/app-text";
import { Badge } from "./ui/badge";

const statusTone = {
  pending: "neutral",
  in_progress: "warn",
  completed: "ok",
  cancelled: "danger",
} as const;

const statusLabel = {
  pending: "Pending",
  in_progress: "In progress",
  completed: "Completed",
  cancelled: "Cancelled",
};

export function TaskCard({ task }: { task: Task }) {
  const router = useRouter();
  const overdue =
    task.due_at &&
    task.status !== "completed" &&
    task.status !== "cancelled" &&
    new Date(task.due_at).getTime() < Date.now();

  return (
    <Pressable
      onPress={() => router.push({ pathname: "/tasks/[id]", params: { id: task.id } })}
      className="rounded-3xl border border-line bg-surface p-4 active:opacity-80"
    >
      <View className="flex-row items-start gap-3">
        <View className="flex-1">
          <View className="mb-2 flex-row flex-wrap items-center gap-2">
            <Badge label={statusLabel[task.status]} tone={statusTone[task.status]} dot />
            {overdue ? <Badge label="Overdue" tone="danger" /> : null}
          </View>
          <AppText variant="title" numberOfLines={2}>{task.title}</AppText>
          {task.description ? (
            <AppText variant="muted" className="mt-1" numberOfLines={2}>
              {task.description}
            </AppText>
          ) : null}
        </View>
        <ChevronRight size={19} color="#5E7693" />
      </View>

      <View className="mt-4 flex-row flex-wrap items-center gap-x-4 gap-y-2 border-t border-line pt-3">
        {task.target_address ? (
          <View className="flex-row items-center gap-1.5">
            <MapPin size={13} color="#8FA6C0" />
            <AppText variant="small" numberOfLines={1} className="max-w-[190px]">
              {task.target_address}
            </AppText>
          </View>
        ) : null}
        {task.due_at ? (
          <View className="flex-row items-center gap-1.5">
            <CalendarClock size={13} color={overdue ? "#FB7185" : "#8FA6C0"} />
            <AppText variant="small" className={overdue ? "text-danger" : ""}>
              {formatDate(task.due_at, { month: "short", day: "numeric" })}
              {" · "}
              {formatTime(task.due_at)}
            </AppText>
          </View>
        ) : null}
        {task.employee_name ? (
          <AppText variant="small" numberOfLines={1}>
            {task.employee_name}
          </AppText>
        ) : task.completion_source ? (
          <AppText variant="small">{titleCase(task.completion_source)}</AppText>
        ) : null}
      </View>
    </Pressable>
  );
}
