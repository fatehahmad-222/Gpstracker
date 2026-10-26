import { useRouter } from "expo-router";
import { ChevronLeft } from "lucide-react-native";
import type { ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  View,
  type ScrollViewProps,
  type ViewProps,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { cn } from "@/lib/cn";
import { AppText } from "./app-text";
import { Button } from "./button";

export function Screen({ children, className, ...props }: ViewProps & { className?: string }) {
  return (
    <SafeAreaView edges={["top"]} className="flex-1 bg-canvas">
      <View className={cn("flex-1 bg-canvas", className)} {...props}>
        {children}
      </View>
    </SafeAreaView>
  );
}

export function ScreenScroll({
  children,
  className,
  contentContainerClassName,
  refreshing,
  onRefresh,
  ...props
}: ScrollViewProps & {
  className?: string;
  contentContainerClassName?: string;
  refreshing?: boolean;
  onRefresh?: () => void;
}) {
  return (
    <Screen>
      <ScrollView
        className={cn("flex-1", className)}
        contentContainerClassName={cn("px-5 pb-32 pt-2", contentContainerClassName)}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        refreshControl={
          onRefresh ? (
            <RefreshControl
              refreshing={Boolean(refreshing)}
              onRefresh={onRefresh}
              tintColor="#8FA6C0"
              colors={["#3B82F6"]}
            />
          ) : undefined
        }
        {...props}
      >
        {children}
      </ScrollView>
    </Screen>
  );
}

export function PageHeader({
  title,
  subtitle,
  back = false,
  right,
  eyebrow,
}: {
  title: string;
  subtitle?: string;
  back?: boolean;
  right?: ReactNode;
  eyebrow?: string;
}) {
  const router = useRouter();
  return (
    <View className="mb-5 flex-row items-start justify-between gap-3 pt-2">
      {back ? (
        <Pressable
          onPress={() => router.back()}
          hitSlop={12}
          className="mr-1 mt-1 h-9 w-9 items-center justify-center rounded-full border border-line bg-surface active:opacity-70"
        >
          <ChevronLeft size={20} color="#E8F1FB" />
        </Pressable>
      ) : null}
      <View className="flex-1">
        {eyebrow ? <AppText variant="tiny" className="mb-1.5">{eyebrow}</AppText> : null}
        <AppText variant="heading" numberOfLines={2}>{title}</AppText>
        {subtitle ? <AppText variant="muted" className="mt-1">{subtitle}</AppText> : null}
      </View>
      {right ? <View className="mt-1">{right}</View> : null}
    </View>
  );
}

export function LoadingState({ label = "Loading" }: { label?: string }) {
  return (
    <View className="flex-1 items-center justify-center gap-3 bg-canvas px-8">
      <ActivityIndicator color="#3B82F6" />
      <AppText variant="muted">{label}</AppText>
    </View>
  );
}

export function ErrorState({
  title = "Could not load this",
  message,
  onRetry,
}: {
  title?: string;
  message?: string;
  onRetry?: () => void;
}) {
  return (
    <View className="items-center justify-center px-6 py-16">
      <AppText variant="title" className="text-center">{title}</AppText>
      <AppText variant="muted" className="mt-2 text-center">
        {message || "Check your connection and try again."}
      </AppText>
      {onRetry ? (
        <Button variant="secondary" className="mt-5" onPress={onRetry}>
          Try again
        </Button>
      ) : null}
    </View>
  );
}

export function EmptyState({
  icon,
  title,
  message,
  action,
}: {
  icon?: ReactNode;
  title: string;
  message?: string;
  action?: ReactNode;
}) {
  return (
    <View className="items-center justify-center rounded-3xl border border-line bg-surface px-6 py-12">
      {icon ? <View className="mb-4">{icon}</View> : null}
      <AppText variant="title" className="text-center">{title}</AppText>
      {message ? (
        <AppText variant="muted" className="mt-2 max-w-[280px] text-center">
          {message}
        </AppText>
      ) : null}
      {action ? <View className="mt-5">{action}</View> : null}
    </View>
  );
}
