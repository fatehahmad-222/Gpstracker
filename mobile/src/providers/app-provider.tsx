import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as Notifications from "expo-notifications";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  type ReactNode,
} from "react";
import { Platform } from "react-native";

import { apiRequest } from "@/lib/api";
import { QUERY_KEYS } from "@/lib/constants";
import { registerPushToken } from "@/lib/notifications";
import type { Bootstrap } from "@/lib/types";
import { useAuth } from "./auth-provider";

export type AppStage = "loading" | "login" | "unlinked" | "consent" | "enrollment" | "blocked" | "main";

type AppContextValue = {
  bootstrap: Bootstrap | null;
  stage: AppStage;
  loading: boolean;
  error: Error | null;
  refresh: () => Promise<unknown>;
  isAdmin: boolean;
  isEmployee: boolean;
};

const AppContext = createContext<AppContextValue | null>(null);

function resolveStage(bootstrap: Bootstrap | null, loading: boolean, hasSession: boolean): AppStage {
  if (!hasSession) return "login";
  if (loading || !bootstrap) return "loading";
  if (bootstrap.role !== "employee") return "main";
  if (!bootstrap.employee) return "unlinked";
  if (!bootstrap.tracking.consent) return "consent";
  if (bootstrap.enrollment.required) {
    if (
      bootstrap.enrollment.revoked_device &&
      !bootstrap.enrollment.revoked_device.can_reenroll
    ) {
      return "blocked";
    }
    return "enrollment";
  }
  return "main";
}

export function AppProvider({ children }: { children: ReactNode }) {
  const { session, loading: authLoading } = useAuth();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: QUERY_KEYS.bootstrap,
    queryFn: () => apiRequest<Bootstrap>("/api/app/bootstrap"),
    enabled: Boolean(session),
    staleTime: 30_000,
    retry: (count, error) => {
      const status = (error as { status?: number })?.status;
      if (status === 401 || status === 403) return false;
      return count < 2;
    },
  });

  const stage = resolveStage(query.data ?? null, query.isLoading, Boolean(session));
  const bootstrap = query.data ?? null;

  const refresh = useCallback(() => query.refetch(), [query]);

  useEffect(() => {
    if (stage !== "main" || bootstrap?.role !== "employee" || bootstrap.push.registered) return;
    if (Platform.OS === "web") return;

    let cancelled = false;
    (async () => {
      const current = await Notifications.getPermissionsAsync();
      if (!cancelled && current.granted) await registerPushToken();
    })();

    return () => {
      cancelled = true;
    };
  }, [stage, bootstrap?.role, bootstrap?.push.registered]);

  const value = useMemo<AppContextValue>(
    () => ({
      bootstrap,
      stage,
      loading: authLoading || (Boolean(session) && query.isLoading),
      error: (query.error as Error) ?? null,
      refresh,
      isAdmin: bootstrap?.role === "admin",
      isEmployee: bootstrap?.role === "employee",
    }),
    [bootstrap, stage, authLoading, session, query.isLoading, query.error, refresh]
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const value = useContext(AppContext);
  if (!value) throw new Error("useApp must be used inside AppProvider");
  return value;
}

export function useInvalidateBootstrap() {
  const queryClient = useQueryClient();
  return useCallback(
    () => queryClient.invalidateQueries({ queryKey: QUERY_KEYS.bootstrap }),
    [queryClient]
  );
}
