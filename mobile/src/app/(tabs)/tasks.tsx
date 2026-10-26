import { useQuery } from "@tanstack/react-query";
import { ClipboardList } from "lucide-react-native";
import { useState } from "react";
import { View } from "react-native";

import { TaskCard } from "@/components/task-card";
import { AppText } from "@/components/ui/app-text";
import { Card } from "@/components/ui/card";
import { EmptyState, ErrorState, PageHeader, ScreenScroll } from "@/components/ui/screen";
import { Segmented } from "@/components/ui/segmented";
import { apiRequest } from "@/lib/api";
import { QUERY_KEYS } from "@/lib/constants";
import type { Task } from "@/lib/types";

const filters = [
  { key: "all", label: "All" },
  { key: "open", label: "Open" },
  { key: "in_progress", label: "Started" },
  { key: "completed", label: "Done" },
];

export default function TasksScreen() {
  const [filter, setFilter] = useState("open");

  const query = useQuery({
    queryKey: QUERY_KEYS.tasks(filter),
    queryFn: () =>
      apiRequest<{ rows: Task[] }>(`/api/app/tasks?status=${encodeURIComponent(filter)}`),
    refetchInterval: 45_000,
  });

  const rows = query.data?.rows || [];

  return (
    <ScreenScroll
      refreshing={query.isRefetching}
      onRefresh={() => query.refetch()}
      contentContainerClassName="px-5 pb-32 pt-2"
    >
      <PageHeader
        eyebrow="Field work"
        title="My tasks"
        subtitle="Work assigned to you, newest deadline first."
      />

      <Segmented options={filters} value={filter} onChange={setFilter} scroll={false} />

      <Card className="mt-3 flex-row items-center gap-3 border-brand/20 bg-brand/[0.04] py-3">
        <ClipboardList size={17} color="#7CB4FF" />
        <AppText variant="small" className="flex-1">
          {filter === "open"
            ? "Start a task when you arrive, then mark it complete."
            : "Tap a task to see its location and update progress."}
        </AppText>
      </Card>

      <View className="mt-4 gap-3">
        {query.isError ? (
          <ErrorState
            title="Could not load tasks"
            message="Check your connection and try again."
            onRetry={() => query.refetch()}
          />
        ) : query.isLoading ? (
          <Card className="items-center py-8">
            <AppText variant="small">Loading your tasks…</AppText>
          </Card>
        ) : rows.length ? (
          rows.map((task) => <TaskCard key={task.id} task={task} />)
        ) : (
          <EmptyState
            icon={<ClipboardList size={28} color="#5E7693" />}
            title={filter === "open" ? "No open tasks" : "Nothing here"}
            message={
              filter === "open"
                ? "You are all caught up. New assignments will appear here."
                : "No tasks match this filter."
            }
          />
        )}
      </View>
    </ScreenScroll>
  );
}
