import { Navigation2 } from "lucide-react-native";
import { View } from "react-native";

import { cn } from "@/lib/cn";
import { AppText } from "./ui/app-text";

export function LogoMark({ size = 44, className }: { size?: number; className?: string }) {
  return (
    <View
      className={cn("items-center justify-center rounded-2xl bg-brand", className)}
      style={{
        width: size,
        height: size,
        shadowColor: "#3B82F6",
        shadowOpacity: 0.35,
        shadowRadius: 18,
        shadowOffset: { width: 0, height: 8 },
        elevation: 8,
      }}
    >
      <Navigation2 size={size * 0.48} color="#FFFFFF" fill="#FFFFFF" />
    </View>
  );
}

export function Wordmark({ compact = false }: { compact?: boolean }) {
  return (
    <View className="flex-row items-center gap-3">
      <LogoMark size={compact ? 34 : 44} />
      <View>
        <AppText className="font-display text-[18px] tracking-[-0.4px] text-ink">
          Fleet Console
        </AppText>
        <AppText className="text-[9px] font-semibold uppercase tracking-[2px] text-faint">
          Field operations
        </AppText>
      </View>
    </View>
  );
}
