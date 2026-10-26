import type { ReactNode } from "react";
import { View, type ViewProps } from "react-native";

import { cn } from "@/lib/cn";

export function Card({
  children,
  className,
  ...props
}: ViewProps & { className?: string; children?: ReactNode }) {
  return (
    <View
      className={cn("rounded-3xl border border-line bg-surface p-4", className)}
      {...props}
    >
      {children}
    </View>
  );
}

export function Divider({ className }: { className?: string }) {
  return <View className={cn("h-px bg-line", className)} />;
}
