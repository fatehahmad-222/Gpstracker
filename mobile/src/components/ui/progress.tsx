import { View } from "react-native";

import { cn } from "@/lib/cn";

export function Progress({
  value,
  className,
  tone = "brand",
}: {
  value: number;
  className?: string;
  tone?: "brand" | "ok" | "warn" | "danger" | "cyan";
}) {
  const tones = {
    brand: "bg-brand",
    ok: "bg-ok",
    warn: "bg-warn",
    danger: "bg-danger",
    cyan: "bg-cyan",
  };
  return (
    <View className={cn("h-1.5 overflow-hidden rounded-full bg-line", className)}>
      <View
        className={cn("h-full rounded-full", tones[tone])}
        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
      />
    </View>
  );
}
