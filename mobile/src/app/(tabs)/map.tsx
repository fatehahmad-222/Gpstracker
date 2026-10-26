import { useQuery } from "@tanstack/react-query";
import { MapPin, RefreshCw } from "lucide-react-native";
import { Pressable, View } from "react-native";

import { MapView } from "@/components/map/map-view";
import type { MapPoint } from "@/components/map/map-types";
import { AppText } from "@/components/ui/app-text";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { ErrorState, LoadingState } from "@/components/ui/screen";
import { apiRequest } from "@/lib/api";
import { QUERY_KEYS } from "@/lib/constants";
import { timeAgo } from "@/lib/format";
import { cn } from "@/lib/cn";
import type { Position } from "@/lib/types";

type PositionsResponse = {
  rows: Position[];
  total: number;
  served_at: string;
};

export default function MapScreen() {
  const query = useQuery({
    queryKey: QUERY_KEYS.positions,
    queryFn: () => apiRequest<PositionsResponse>("/api/monitor/positions"),
    refetchInterval: 15_000,
  });

  const rows = query.data?.rows || [];
  const live = rows.filter((row) => row.freshness === "live").length;
  const stale = rows.filter((row) => row.freshness === "stale" || row.freshness === "gone").length;

  const points: MapPoint[] = rows.map((row) => ({
    id: row.employee_id,
    lat: Number(row.lat),
    lng: Number(row.lng),
    name: row.name,
    subtitle: [
      row.emp_code,
      row.freshness === "live" ? "Live" : `Last seen ${timeAgo(row.recorded_at).toLowerCase()}`,
      row.battery != null ? `${row.battery}% battery` : null,
      row.inside_fence === false ? "Outside assigned area" : null,
    ]
      .filter(Boolean)
      .join(" · "),
    tone: row.inside_fence === false ? "warn" : "brand",
    stale: row.freshness !== "live",
  }));

  if (query.isLoading) return <LoadingState label="Loading field map" />;

  return (
    <View className="flex-1 bg-canvas">
      <View className="flex-row items-start justify-between px-5 pb-3 pt-4">
        <View>
          <AppText variant="tiny">Live operations</AppText>
          <AppText variant="heading" className="mt-1">Field map</AppText>
          <View className="mt-2 flex-row items-center gap-2">
            <Badge label={`${live} live`} tone={live ? "ok" : "neutral"} dot />
            {stale ? <Badge label={`${stale} stale`} tone="warn" /> : null}
            <AppText className="text-[10px] text-faint">
              {query.data?.served_at ? `Updated ${timeAgo(query.data.served_at).toLowerCase()}` : "Polling 15s"}
            </AppText>
          </View>
        </View>
        <Pressable
          onPress={() => query.refetch()}
          className="mt-1 h-10 w-10 items-center justify-center rounded-2xl border border-line bg-surface active:opacity-70"
        >
          <RefreshCw size={17} color="#8FA6C0" className={query.isRefetching ? "animate-spin" : ""} />
        </Pressable>
      </View>

      {query.isError ? (
        <View className="px-5">
          <ErrorState
            title="Live map unavailable"
            message="Positions could not be loaded."
            onRetry={() => query.refetch()}
          />
        </View>
      ) : (
        <View className="mx-4 mb-2 flex-1">
          <MapView
            points={points}
            initialZoom={12}
            emptyLabel="No field positions yet. Positions appear once an employee starts a shift."
          />
        </View>
      )}

      <View className="px-4 pb-3">
        <Card
          className={cn(
            "flex-row items-center gap-3 py-3",
            rows.length ? "border-line" : "border-warn/25 bg-warn/[0.04]"
          )}
        >
          <View className="h-9 w-9 items-center justify-center rounded-xl bg-raised">
            <MapPin size={16} color={rows.length ? "#7CB4FF" : "#FBBF24"} />
          </View>
          <View className="flex-1">
            <AppText className="text-[12px] font-semibold">
              {rows.length
                ? `${rows.length} field position${rows.length === 1 ? "" : "s"}`
                : "Waiting for the first signal"}
            </AppText>
            <AppText className="mt-0.5 text-[10px] text-faint">
              Tap a pin for who it belongs to. Inside/outside hints use assigned geofences only.
            </AppText>
          </View>
        </Card>
      </View>
    </View>
  );
}
