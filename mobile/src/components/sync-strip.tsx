import { CloudOff, RefreshCw, Radio } from "lucide-react-native";
import { Pressable, View } from "react-native";

import { cn } from "@/lib/cn";
import { timeAgo } from "@/lib/format";
import { useTracking } from "@/providers/tracking-provider";
import { AppText } from "./ui/app-text";

export function SyncStrip({ compact = false }: { compact?: boolean }) {
  const { active, pending, lastSync, syncing, syncNow } = useTracking();

  if (!active && !pending) return null;

  const waiting = pending > 0;
  const tone = waiting ? "border-warn/25 bg-warn/[0.07]" : "border-line bg-surface";

  return (
    <Pressable
      onPress={() => syncNow()}
      disabled={syncing}
      className={cn(
        "flex-row items-center gap-3 rounded-2xl border px-3.5 active:opacity-80",
        compact ? "py-2.5" : "py-3",
        tone
      )}
    >
      <View className={cn("h-8 w-8 items-center justify-center rounded-full", waiting ? "bg-warn/15" : "bg-ok/12")}>
        {waiting ? (
          <CloudOff size={15} color="#FBBF24" />
        ) : (
          <Radio size={15} color="#34D399" />
        )}
      </View>
      <View className="flex-1">
        <AppText className={cn("text-[12px] font-semibold", waiting ? "text-warn" : "text-ink")}>
          {waiting ? `${pending} record${pending === 1 ? "" : "s"} waiting to sync` : "Shift tracking active"}
        </AppText>
        <AppText className="mt-0.5 text-[10px] text-faint">
          {lastSync ? `Last sync ${timeAgo(lastSync).toLowerCase()}` : "Waiting for the first location"}
        </AppText>
      </View>
      <RefreshCw size={14} color="#8FA6C0" className={syncing ? "animate-spin" : ""} />
    </Pressable>
  );
}
