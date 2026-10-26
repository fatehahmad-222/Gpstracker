import {
  Camera,
  Map,
  Marker,
  UserLocation,
  type StyleSpecification,
} from "@maplibre/maplibre-react-native";
import { useState } from "react";
import { Pressable, View } from "react-native";

import { OSM_STYLE } from "@/lib/constants";
import { env } from "@/lib/env";
import { cn } from "@/lib/cn";
import { AppText } from "../ui/app-text";
import type { MapPoint, MapViewProps } from "./map-types";

const tones: Record<NonNullable<MapPoint["tone"]>, string> = {
  brand: "#3B82F6",
  ok: "#34D399",
  warn: "#FBBF24",
  danger: "#FB7185",
  cyan: "#22D3EE",
};

export function MapView({
  points,
  initialCenter,
  initialZoom = 13,
  showUser = false,
  onSelect,
  emptyLabel = "No positions to show",
}: MapViewProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const first = points[0];
  const center = initialCenter || (first ? { lat: first.lat, lng: first.lng } : null);
  const selected = points.find((point) => point.id === selectedId) || null;

  const mapStyle = (env.mapStyleUrl || OSM_STYLE) as unknown as StyleSpecification;

  if (!center) {
    return (
      <View className="flex-1 items-center justify-center rounded-3xl border border-line bg-surface px-6">
        <AppText variant="small" className="text-center">{emptyLabel}</AppText>
      </View>
    );
  }

  return (
    <View className="flex-1 overflow-hidden rounded-3xl border border-line bg-surface">
      <Map
        mapStyle={mapStyle}
        style={{ flex: 1 }}
        logo={false}
        attribution
        attributionPosition={{ bottom: 8, right: 8 }}
        compass
        compassPosition={{ top: 12, right: 12 }}
      >
        <Camera
          initialViewState={{ center: [center.lng, center.lat], zoom: initialZoom }}
          minZoom={3}
          maxZoom={18}
        />
        {showUser ? <UserLocation accuracy={false} heading={false} /> : null}

        {points
          .filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng))
          .map((point) => {
            const isSelected = point.id === selectedId;
            const color = tones[point.stale ? "warn" : point.tone || "brand"];
            return (
              <Marker
                key={point.id}
                id={point.id}
                lngLat={[point.lng, point.lat]}
                anchor="bottom"
                onPress={() => {
                  const next = isSelected ? null : point;
                  setSelectedId(next?.id || null);
                  onSelect?.(next);
                }}
              >
                <View className="items-center">
                  <View
                    className={cn(
                      "items-center justify-center rounded-full border-2",
                      isSelected ? "h-10 w-10" : "h-7 w-7"
                    )}
                    style={{
                      backgroundColor: color,
                      borderColor: "#07111F",
                      shadowColor: "#000",
                      shadowOpacity: 0.3,
                      shadowRadius: 4,
                      shadowOffset: { width: 0, height: 2 },
                      elevation: 3,
                    }}
                  >
                    <View className="h-2 w-2 rounded-full bg-white" />
                  </View>
                  <View style={{ width: 2, height: 6, backgroundColor: color }} />
                </View>
              </Marker>
            );
          })}
      </Map>

      {selected ? (
        <Pressable
          onPress={() => {
            setSelectedId(null);
            onSelect?.(null);
          }}
          className="absolute bottom-3 left-3 right-3 rounded-2xl border border-line bg-surface/95 px-4 py-3"
        >
          <AppText className="text-[13px] font-semibold">{selected.name}</AppText>
          {selected.subtitle ? (
            <AppText className="mt-0.5 text-[11px] text-faint">{selected.subtitle}</AppText>
          ) : null}
        </Pressable>
      ) : null}
    </View>
  );
}
