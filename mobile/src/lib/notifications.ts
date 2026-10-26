import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

import { apiRequest } from "./api";
import { STORAGE_KEYS } from "./constants";
import { getDeviceId, mobilePlatform } from "./device";
import { env } from "./env";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

function projectId() {
  if (env.easProjectId) return env.easProjectId;
  return (
    Constants.expoConfig?.extra?.eas?.projectId ||
    (Constants as unknown as { easConfig?: { projectId?: string } }).easConfig?.projectId ||
    null
  );
}

export async function ensureNotificationChannel() {
  if (Platform.OS !== "android") return;
  await Notifications.setNotificationChannelAsync("default", {
    name: "Fleet updates",
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: "#3B82F6",
  });
}

export async function requestNotificationPermission() {
  if (Platform.OS === "web") return false;
  await ensureNotificationChannel();
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  if (!current.canAskAgain) return false;
  const next = await Notifications.requestPermissionsAsync();
  return next.granted;
}

export async function registerPushToken() {
  if (Platform.OS === "web") return { ok: false as const, reason: "unsupported" };

  const granted = await requestNotificationPermission();
  if (!granted) return { ok: false as const, reason: "permission" };

  const id = projectId();
  if (!id) return { ok: false as const, reason: "project_id" };

  try {
    const token = await Notifications.getExpoPushTokenAsync({ projectId: id });
    const deviceId = await getDeviceId();

    await apiRequest<{ record: unknown }>("/api/app/push-token", {
      method: "POST",
      body: {
        token: token.data,
        platform: mobilePlatform(),
        device_id: deviceId,
      },
    });

    await SecureStore.setItemAsync(STORAGE_KEYS.pushToken, token.data);
    return { ok: true as const, token: token.data };
  } catch (error) {
    return { ok: false as const, reason: (error as Error)?.message || "failed" };
  }
}

export async function unregisterPushToken() {
  const token = await SecureStore.getItemAsync(STORAGE_KEYS.pushToken);
  if (!token) return;
  try {
    await apiRequest("/api/app/push-token", {
      method: "DELETE",
      body: { token },
    });
  } catch {
    // The local token is still removed; the server can disable it later.
  }
  await SecureStore.deleteItemAsync(STORAGE_KEYS.pushToken);
}
