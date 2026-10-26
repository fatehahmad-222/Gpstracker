import { View } from "react-native";

import { cn } from "@/lib/cn";
import { AppText } from "./app-text";

type Tone = "neutral" | "brand" | "ok" | "warn" | "danger" | "cyan" | "dark";

const tones: Record<Tone, { box: string; text: string; dot: string }> = {
  neutral: { box: "bg-raised border-line", text: "text-dim", dot: "bg-dim" },
  brand: { box: "bg-brand/15 border-brand/35", text: "text-[#7CB4FF]", dot: "bg-brand" },
  ok: { box: "bg-ok/12 border-ok/30", text: "text-ok", dot: "bg-ok" },
  warn: { box: "bg-warn/12 border-warn/30", text: "text-warn", dot: "bg-warn" },
  danger: { box: "bg-danger/12 border-danger/30", text: "text-danger", dot: "bg-danger" },
  cyan: { box: "bg-cyan/12 border-cyan/30", text: "text-cyan", dot: "bg-cyan" },
  dark: { box: "bg-canvas border-line", text: "text-ink", dot: "bg-faint" },
};

export function Badge({
  label,
  tone = "neutral",
  dot = false,
  className,
}: {
  label: string;
  tone?: Tone;
  dot?: boolean;
  className?: string;
}) {
  const style = tones[tone];
  return (
    <View
      className={cn(
        "flex-row items-center gap-1.5 rounded-full border px-2.5 py-1",
        style.box,
        className
      )}
    >
      {dot ? <View className={cn("h-1.5 w-1.5 rounded-full", style.dot)} /> : null}
      <AppText className={cn("text-[11px] font-semibold", style.text)}>{label}</AppText>
    </View>
  );
}
