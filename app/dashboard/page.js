"use client";

import dynamic from "next/dynamic";
import { useCallback, useState } from "react";
import { Plus } from "lucide-react";
import { useLiveOverview } from "@/hooks/useLiveOverview";
import StatsBar from "@/components/dashboard/StatsBar";
import EmployeeSidebar from "@/components/dashboard/EmployeeSidebar";
import NewTaskModal from "@/components/dashboard/NewTaskModal";
import { Button } from "@/components/ui/Button";
import { MapLoading } from "@/components/map/MapLoading";

const OverviewMap = dynamic(() => import("@/components/dashboard/OverviewMap"), {
  ssr: false,
  loading: () => <MapLoading />,
});

export default function DashboardPage() {
  const { profiles, positions, tasks, loading, connection, now } = useLiveOverview();
  const [selectedId, setSelectedId] = useState(null);
  const [focus, setFocus] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);

  const handleSelect = useCallback(
    (id) => {
      setSelectedId(id);
      const pos = positions[id];
      if (pos) setFocus({ lat: pos.lat, lng: pos.lng, ts: Date.now() });
    },
    [positions]
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-semibold tracking-tight text-ink">
            Overview
          </h1>
          <p className="mt-0.5 text-sm text-ink-dim">
            Live positions, online status, and active tasks for every employee.
          </p>
        </div>
        <Button onClick={() => setModalOpen(true)}>
          <Plus size={16} />
          New task
        </Button>
      </div>

      <StatsBar profiles={profiles} positions={positions} tasks={tasks} now={now} loading={loading} />

      <div className="grid gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
        <div className="order-2 overflow-hidden rounded-card border border-line bg-surface lg:order-1 lg:h-[calc(100dvh-230px)]">
          <EmployeeSidebar
            profiles={profiles}
            positions={positions}
            tasks={tasks}
            selectedId={selectedId}
            onSelect={handleSelect}
            now={now}
            loading={loading}
          />
        </div>

        <div className="order-1 h-[420px] overflow-hidden rounded-card border border-line lg:order-2 lg:h-[calc(100dvh-230px)]">
          <OverviewMap
            profiles={profiles}
            positions={positions}
            tasks={tasks}
            selectedId={selectedId}
            onSelect={handleSelect}
            focus={focus}
            now={now}
            connection={connection}
          />
        </div>
      </div>

      <NewTaskModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        employees={profiles}
      />
    </div>
  );
}
