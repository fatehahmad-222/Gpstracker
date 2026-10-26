import { View } from "react-native";

import { cn } from "@/lib/cn";
import { AppText } from "./app-text";

const accents: Record<string, { bar: string; value: string }> = {
  green: { bar: "bg-ok", value: "text-ok" },
  red: { bar: "bg-danger", value: "text-danger" },
  amber: { bar: "bg-warn", value: "text-warn" },
  blue: { bar: "bg-brand", value: "text-[#7CB4FF]" },
  slate: { bar: "bg-faint", value: "text-ink" },
};

export function StatTile({
  label,
  value,
  hint,
  accent = "slate",
  className,
}: {
  label: string;
  value: string | number;
  hint?: string;
  accent?: string;
  className?: string;
}) {
  const style = accents[accent] || accents.slate;
  return (
    <View className={cn("flex-1 overflow-hidden rounded-2xl border border-line bg-surface p-3.5", className)}>
      <View className={cn("mb-3 h-1 w-7 rounded-full", style.bar)} />
      <AppText className={cn("font-display text-[26px] leading-8", style.value)}>{value}</AppText>
      <AppText className="mt-0.5 text-[12px] font-medium text-dim">{label}</AppText>
      {hint ? <AppText className="mt-1 text-[10px] text-faint" numberOfLines={1}>{hint}</AppText> : null}
    </View>
  );
}
