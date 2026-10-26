import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AppState, Platform } from "react-native";

import { STORAGE_KEYS } from "@/lib/constants";
import {
  currentPosition,
  locationPermissionState,
  startBackgroundTracking,
  stopBackgroundTracking,
  trackingIsRunning,
  type PermissionState,
} from "@/lib/tracking/controller";
import {
  flushQueue,
  isDeviceRevoked,
  lastSyncAt,
  pendingQueue,
  type FlushResult,
} from "@/lib/tracking/queue";
import { useApp, useInvalidateBootstrap } from "./app-provider";

type TrackingContextValue = {
  active: boolean;
  pending: number;
  pendingEvents: number;
  pendingPings: number;
  lastSync: string | null;
  permission: PermissionState;
  error: string | null;
  syncing: boolean;
  start: () => Promise<boolean>;
  stop: () => Promise<void>;
  syncNow: () => Promise<FlushResult>;
  refreshPermissions: () => Promise<void>;
  locateMe: typeof currentPosition;
  clearError: () => void;
};

const TrackingContext = createContext<TrackingContextValue | null>(null);

export function TrackingProvider({ children }: { children: ReactNode }) {
  const { bootstrap, stage } = useApp();
  const invalidateBootstrap = useInvalidateBootstrap();

  const [active, setActive] = useState(false);
  const [pendingEvents, setPendingEvents] = useState(0);
  const [pendingPings, setPendingPings] = useState(0);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [permission, setPermission] = useState<PermissionState>({
    foreground: false,
    background: false,
    canAskAgain: true,
  });
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  const initialized = useRef(false);
  const resuming = useRef(false);

  const refreshQueue = useCallback(async () => {
    const snapshot = await pendingQueue();
    setPendingEvents(snapshot.events);
    setPendingPings(snapshot.pings);
    setLastSync(await lastSyncAt());
  }, []);

  const refreshPermissions = useCallback(async () => {
    setPermission(await locationPermissionState());
  }, []);

  const handleRevoked = useCallback(async () => {
    setActive(false);
    await AsyncStorage.removeItem(STORAGE_KEYS.trackingActive);
    await stopBackgroundTracking();
    setError("This device was signed out by an administrator. Sign in again to re-enroll.");
    await invalidateBootstrap();
  }, [invalidateBootstrap]);

  const syncNow = useCallback(async () => {
    setSyncing(true);
    try {
      const result = await flushQueue();
      if (result.status === "revoked") await handleRevoked();
      await refreshQueue();
      return result;
    } finally {
      setSyncing(false);
    }
  }, [handleRevoked, refreshQueue]);

  const start = useCallback(async () => {
    if (Platform.OS === "web") {
      setError("Background shift tracking needs the installed Android or iOS app.");
      return false;
    }
    if (await isDeviceRevoked()) {
      await handleRevoked();
      return false;
    }

    setError(null);
    const result = await startBackgroundTracking({
      intervalMs: bootstrap?.tracking.interval_ms || 60_000,
      distanceM: bootstrap?.tracking.distance_m || 50,
    });

    await refreshPermissions();

    if (!result.ok) {
      setError(
        result.reason === "foreground_permission"
          ? "Allow location access while using the app to start a shift."
          : result.reason === "background_permission"
            ? "Choose “Allow all the time” for location so your shift keeps tracking when the screen is off."
            : "Location tracking is not available on this device."
      );
      return false;
    }

    await AsyncStorage.setItem(STORAGE_KEYS.trackingActive, "1");
    setActive(true);
    await syncNow();
    return true;
  }, [bootstrap?.tracking.interval_ms, bootstrap?.tracking.distance_m, handleRevoked, refreshPermissions, syncNow]);

  const stop = useCallback(async () => {
    await stopBackgroundTracking();
    await AsyncStorage.removeItem(STORAGE_KEYS.trackingActive);
    setActive(false);
    await syncNow();
    await refreshPermissions();
  }, [refreshPermissions, syncNow]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const [stored, running] = await Promise.all([
        AsyncStorage.getItem(STORAGE_KEYS.trackingActive),
        trackingIsRunning(),
      ]);
      if (!mounted) return;
      setActive(Boolean(stored) && running);
      await refreshPermissions();
      await refreshQueue();
      initialized.current = true;
    })();
    return () => {
      mounted = false;
    };
  }, [refreshPermissions, refreshQueue]);

  useEffect(() => {
    if (!initialized.current || stage !== "main") return;
    if (bootstrap?.role !== "employee") return;
    if (!active || resuming.current) return;

    resuming.current = true;
    (async () => {
      const running = await trackingIsRunning();
      if (!running) {
        const result = await startBackgroundTracking({
          intervalMs: bootstrap.tracking.interval_ms || 60_000,
          distanceM: bootstrap.tracking.distance_m || 50,
        });
        if (!result.ok) {
          setActive(false);
          await AsyncStorage.removeItem(STORAGE_KEYS.trackingActive);
        } else {
          setActive(true);
        }
      }
      await refreshPermissions();
      resuming.current = false;
    })();
  }, [
    active,
    bootstrap?.role,
    bootstrap?.tracking.distance_m,
    bootstrap?.tracking.interval_ms,
    refreshPermissions,
    stage,
  ]);

  useEffect(() => {
    if (!active) return;

    const tick = () => {
      syncNow();
    };
    const timer = setInterval(tick, 30_000);
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") tick();
    });

    return () => {
      clearInterval(timer);
      subscription.remove();
    };
  }, [active, syncNow]);

  useEffect(() => {
    if (stage !== "main" && active) {
      stopBackgroundTracking();
      AsyncStorage.removeItem(STORAGE_KEYS.trackingActive);
      setActive(false);
    }
  }, [active, stage]);

  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => {
      refreshPermissions();
      refreshQueue();
    }, 60_000);
    return () => clearInterval(timer);
  }, [active, refreshPermissions, refreshQueue]);

  const value = useMemo<TrackingContextValue>(
    () => ({
      active,
      pending: pendingEvents + pendingPings,
      pendingEvents,
      pendingPings,
      lastSync,
      permission,
      error,
      syncing,
      start,
      stop,
      syncNow,
      refreshPermissions,
      locateMe: currentPosition,
      clearError: () => setError(null),
    }),
    [
      active,
      pendingEvents,
      pendingPings,
      lastSync,
      permission,
      error,
      syncing,
      start,
      stop,
      syncNow,
      refreshPermissions,
    ]
  );

  return <TrackingContext.Provider value={value}>{children}</TrackingContext.Provider>;
}

export function useTracking() {
  const value = useContext(TrackingContext);
  if (!value) throw new Error("useTracking must be used inside TrackingProvider");
  return value;
}
