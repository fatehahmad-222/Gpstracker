import { MapPin } from "lucide-react-native";
import { ScrollView, View } from "react-native";

import { AppText } from "../ui/app-text";
import type { MapViewProps } from "./map-types";

export function MapView({ points, emptyLabel = "No positions to show" }: MapViewProps) {
  if (!points.length) {
    return (
      <View className="flex-1 items-center justify-center rounded-3xl border border-line bg-surface px-6">
        <MapPin size={24} color="#5E7693" />
        <AppText variant="small" className="mt-2 text-center">{emptyLabel}</AppText>
      </View>
    );
  }

  return (
    <View className="flex-1 overflow-hidden rounded-3xl border border-line bg-surface">
      <View className="border-b border-line bg-raised px-4 py-2.5">
        <AppText variant="tiny">Native map is available in the installed app</AppText>
      </View>
      <ScrollView contentContainerClassName="p-2">
        {points.map((point) => (
          <View
            key={point.id}
            className="mb-1 rounded-2xl border border-line bg-canvas px-3.5 py-3"
          >
            <AppText className="text-[13px] font-semibold">{point.name}</AppText>
            <AppText className="mt-0.5 text-[11px] text-faint">
              {point.subtitle || `${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}`}
            </AppText>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}
