"use client";

import dynamic from "next/dynamic";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/components/providers/AuthProvider";
import { useOwnTasks } from "@/hooks/useOwnTasks";
import { useTracking } from "@/components/employee/EmployeeTracker";
import { MapLoading } from "@/components/map/MapLoading";

const EmployeeMap = dynamic(() => import("@/components/map/EmployeeMap"), {
  ssr: false,
  loading: () => <MapLoading />,
});

function MapView() {
  const searchParams = useSearchParams();
  const { user } = useAuth();
  const { tasks } = useOwnTasks(user?.id);
  const tracking = useTracking();
  const focusTaskId = searchParams.get("task");

  return (
    <div className="relative overflow-hidden rounded-card border border-line">
      <div className="h-[70dvh] w-full">
        <EmployeeMap
          position={tracking.position}
          accuracy={tracking.accuracy}
          tasks={tasks ?? []}
          focusTaskId={focusTaskId}
        />
      </div>
      <div className="pointer-events-none absolute bottom-3 left-3 rounded-pill border border-line bg-surface/90 px-3 py-1.5 text-xs text-ink-dim backdrop-blur">
        Blue dot = you · red pin = task target
      </div>
    </div>
  );
}

export default function EmployeeMapPage() {
  return (
    <Suspense fallback={<div className="h-[70dvh] w-full"><MapLoading /></div>}>
      <MapView />
    </Suspense>
  );
}
