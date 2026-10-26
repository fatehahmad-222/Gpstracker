import { Pressable, ScrollView, View } from "react-native";

import { cn } from "@/lib/cn";
import { AppText } from "./app-text";

export type SegmentOption = { key: string; label: string; count?: number };

export function Segmented({
  options,
  value,
  onChange,
  scroll = true,
}: {
  options: SegmentOption[];
  value: string;
  onChange: (key: string) => void;
  scroll?: boolean;
}) {
  const content = (
    <View className="flex-row gap-2 rounded-2xl border border-line bg-surface p-1">
      {options.map((option) => {
        const active = option.key === value;
        return (
          <Pressable
            key={option.key}
            onPress={() => onChange(option.key)}
            className={cn(
              "flex-1 flex-row items-center justify-center gap-1.5 rounded-xl px-3 py-2 active:opacity-75",
              active ? "bg-raised" : "bg-transparent"
            )}
          >
            <AppText
              className={cn(
                "text-[12px] font-semibold",
                active ? "text-ink" : "text-faint"
              )}
            >
              {option.label}
            </AppText>
            {option.count != null ? (
              <View className={cn("rounded-full px-1.5 py-0.5", active ? "bg-brand/20" : "bg-canvas")}>
                <AppText className={cn("text-[9px]", active ? "text-[#7CB4FF]" : "text-faint")}>
                  {option.count}
                </AppText>
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );

  if (!scroll) return content;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="min-w-full">
      {content}
    </ScrollView>
  );
}
