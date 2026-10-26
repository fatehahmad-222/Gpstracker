import "@/global.css";

import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from "@expo-google-fonts/inter";
import {
  SpaceGrotesk_500Medium,
  SpaceGrotesk_700Bold,
} from "@expo-google-fonts/space-grotesk";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as Notifications from "expo-notifications";
import { Stack, useRouter } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { Platform } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { registerBackgroundTask } from "@/lib/tracking/task";
import { AuthProvider } from "@/providers/auth-provider";
import { AppProvider } from "@/providers/app-provider";
import { TrackingProvider } from "@/providers/tracking-provider";

registerBackgroundTask();
SplashScreen.preventAutoHideAsync().catch(() => undefined);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 20_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

function NotificationBridge() {
  const router = useRouter();

  useEffect(() => {
    if (Platform.OS === "web") return;
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data;
      const taskId = typeof data?.task_id === "string" ? data.task_id : null;
      if (taskId) router.push({ pathname: "/tasks/[id]", params: { id: taskId } });
      else if (typeof data?.screen === "string") router.push(data.screen as never);
    });
    return () => subscription.remove();
  }, [router]);

  return null;
}

export default function RootLayout() {
  const [loaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    SpaceGrotesk_500Medium,
    SpaceGrotesk_700Bold,
  });

  useEffect(() => {
    if (loaded || fontError) SplashScreen.hideAsync().catch(() => undefined);
  }, [loaded, fontError]);

  if (!loaded && !fontError) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <AppProvider>
              <TrackingProvider>
                <StatusBar style="light" />
                <NotificationBridge />
                <Stack
                  screenOptions={{
                    headerShown: false,
                    contentStyle: { backgroundColor: "#07111F" },
                    animation: "slide_from_right",
                  }}
                >
                  <Stack.Screen name="index" options={{ animation: "fade" }} />
                  <Stack.Screen name="(tabs)" options={{ animation: "fade" }} />
                </Stack>
              </TrackingProvider>
            </AppProvider>
          </AuthProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
