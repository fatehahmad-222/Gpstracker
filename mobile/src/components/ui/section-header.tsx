import { useRouter } from "expo-router";
import { ChevronRight } from "lucide-react-native";
import { Pressable, View } from "react-native";

import { AppText } from "./app-text";

export function SectionHeader({
  title,
  actionLabel,
  onAction,
  href,
}: {
  title: string;
  actionLabel?: string;
  onAction?: () => void;
  href?: string;
}) {
  const router = useRouter();

  return (
    <View className="mb-3 mt-1 flex-row items-center justify-between">
      <AppText className="font-display text-[16px] tracking-[-0.3px]">{title}</AppText>
      {actionLabel ? (
        <Pressable
          onPress={onAction || (() => href && router.push(href as never))}
          className="flex-row items-center gap-0.5 active:opacity-70"
        >
          <AppText className="text-[12px] font-semibold text-[#7CB4FF]">{actionLabel}</AppText>
          <ChevronRight size={14} color="#7CB4FF" />
        </Pressable>
      ) : null}
    </View>
  );
}
