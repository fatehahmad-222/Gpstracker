import * as Location from "expo-location";
import { Platform } from "react-native";

import { LOCATION_TASK } from "../constants";

export type PermissionState = {
  foreground: boolean;
  background: boolean;
  canAskAgain: boolean;
};

export async function locationPermissionState(): Promise<PermissionState> {
  const [foreground, background] = await Promise.all([
    Location.getForegroundPermissionsAsync(),
    Location.getBackgroundPermissionsAsync(),
  ]);
  return {
    foreground: foreground.status === Location.PermissionStatus.GRANTED,
    background: background.status === Location.PermissionStatus.GRANTED,
    canAskAgain: foreground.canAskAgain || background.canAskAgain,
  };
}

export async function requestLocationPermissions(): Promise<PermissionState> {
  let foreground = await Location.getForegroundPermissionsAsync();
  if (foreground.status !== Location.PermissionStatus.GRANTED) {
    foreground = await Location.requestForegroundPermissionsAsync();
  }

  if (foreground.status !== Location.PermissionStatus.GRANTED) {
    return { foreground: false, background: false, canAskAgain: foreground.canAskAgain };
  }

  let background = await Location.getBackgroundPermissionsAsync();
  if (background.status !== Location.PermissionStatus.GRANTED) {
    background = await Location.requestBackgroundPermissionsAsync();
  }

  return {
    foreground: true,
    background: background.status === Location.PermissionStatus.GRANTED,
    canAskAgain: background.canAskAgain,
  };
}

export async function startBackgroundTracking(options: {
  intervalMs: number;
  distanceM: number;
}) {
  const permission = await requestLocationPermissions();
  if (!permission.foreground) {
    return { ok: false as const, reason: "foreground_permission" };
  }
  if (!permission.background) {
    return { ok: false as const, reason: "background_permission" };
  }

  const already = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK);
  if (already) return { ok: true as const };

  await Location.startLocationUpdatesAsync(LOCATION_TASK, {
    accuracy: Location.Accuracy.High,
    timeInterval: Math.max(30_000, options.intervalMs || 60_000),
    distanceInterval: Math.max(10, options.distanceM || 50),
    deferredUpdatesInterval: 30_000,
    showsBackgroundLocationIndicator: true,
    pausesUpdatesAutomatically: false,
    activityType: Location.ActivityType.OtherNavigation,
    ...(Platform.OS === "android"
      ? {
          foregroundService: {
            notificationTitle: "Fleet Console shift active",
            notificationBody: "Your location is being recorded during this shift.",
            notificationColor: "#3B82F6",
            killServiceOnDestroy: false,
          },
        }
      : {}),
  });

  return { ok: true as const };
}

export async function stopBackgroundTracking() {
  try {
    const started = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK);
    if (started) await Location.stopLocationUpdatesAsync(LOCATION_TASK);
  } catch {
    // Nothing registered on this install.
  }
}

export async function trackingIsRunning() {
  try {
    return await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK);
  } catch {
    return false;
  }
}

export async function currentPosition() {
  const permission = await Location.getForegroundPermissionsAsync();
  if (permission.status !== Location.PermissionStatus.GRANTED) return null;
  try {
    return await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
  } catch {
    return Location.getLastKnownPositionAsync();
  }
}
