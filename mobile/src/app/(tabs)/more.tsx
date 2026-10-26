import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import {
  Bell,
  CalendarCheck2,
  ChevronRight,
  Fingerprint,
  Info,
  LogOut,
  MapPin,
  ShieldCheck,
  SlidersHorizontal,
  UserRound,
} from "lucide-react-native";
import * as Notifications from "expo-notifications";
import { useEffect, useState } from "react";
import { Alert, Linking, Platform, Pressable, View } from "react-native";

import { SyncStrip } from "@/components/sync-strip";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Divider } from "@/components/ui/card";
import { AppText } from "@/components/ui/app-text";
import { PageHeader, ScreenScroll } from "@/components/ui/screen";
import { APP_VERSION } from "@/lib/constants";
import { apiRequest, errorMessage } from "@/lib/api";
import { env } from "@/lib/env";
import { shiftWindow, titleCase } from "@/lib/format";
import { registerPushToken } from "@/lib/notifications";
import { requestLocationPermissions } from "@/lib/tracking/controller";
import { useApp } from "@/providers/app-provider";
import { useAuth } from "@/providers/auth-provider";
import { useTracking } from "@/providers/tracking-provider";

export default function MoreScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { bootstrap, isAdmin, isEmployee, refresh } = useApp();
  const { user, signOut } = useAuth();
  const {
    active,
    pending,
    permission,
    refreshPermissions,
    stop,
    lastSync,
  } = useTracking();

  const [notifications, setNotifications] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (Platform.OS === "web") return;
    Notifications.getPermissionsAsync()
      .then((status) => setNotifications(status.granted))
      .catch(() => undefined);
  }, []);

  const enableNotifications = async () => {
    setWorking(true);
    setError(null);
    try {
      const result = await registerPushToken();
      if (!result.ok) {
        setError(
          result.reason === "project_id"
            ? "Push notifications need an EAS project ID in this build."
            : result.reason === "permission"
              ? "Notifications are blocked in system settings."
              : result.reason
        );
      } else {
        setNotifications(true);
        await refresh();
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setWorking(false);
    }
  };

  const fixLocation = async () => {
    setWorking(true);
    setError(null);
    try {
      const next = await requestLocationPermissions();
      await refreshPermissions();
      if (!next.background) {
        setError(
          "Background location is still off. Open system settings and choose “Allow all the time”."
        );
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setWorking(false);
    }
  };

  const withdrawConsent = () => {
    Alert.alert(
      "Withdraw location consent?",
      "Tracking will stop, this device will no longer be able to sync field data, and you will be signed out of the field app.",
      [
        { text: "Keep consent", style: "cancel" },
        {
          text: "Withdraw",
          style: "destructive",
          onPress: async () => {
            setWorking(true);
            try {
              await stop();
              await apiRequest("/api/app/tracking-consent", {
                method: "POST",
                body: { consent: false },
              });
              await refresh();
              router.replace("/");
            } catch (err) {
              setError(errorMessage(err));
            } finally {
              setWorking(false);
            }
          },
        },
      ]
    );
  };

  const openPrivacy = () => {
    if (env.privacyUrl) Linking.openURL(env.privacyUrl);
    else setError("Your administrator has not published a privacy policy link yet.");
  };

  const logout = async () => {
    await signOut();
    queryClient.clear();
    router.replace("/login");
  };

  const name =
    bootstrap?.employee?.name ||
    user?.email?.split("@")[0]?.replace(/[._-]/g, " ") ||
    "Fleet Console";

  return (
    <ScreenScroll>
      <PageHeader eyebrow="Account" title="More" subtitle="Device, privacy and workspace settings." />

      <Card className="items-center p-6">
        <Avatar
          name={name}
          uri={bootstrap?.employee?.photo_url}
          size={72}
          className="border-brand/30"
        />
        <AppText className="mt-3 text-[18px] font-bold capitalize">{name}</AppText>
        <AppText className="mt-1 text-[11px] text-faint">{user?.email}</AppText>
        <View className="mt-3 flex-row gap-2">
          <Badge
            label={isAdmin ? "Administrator" : isEmployee ? "Employee" : titleCase(bootstrap?.role)}
            tone={isAdmin ? "brand" : "cyan"}
          />
          {isEmployee ? (
            <Badge
              label={bootstrap?.employee?.emp_code || "No code"}
              tone="neutral"
            />
          ) : null}
        </View>
        {isEmployee ? (
          <AppText className="mt-3 text-[11px] text-dim">
            Shift {shiftWindow(bootstrap?.employee?.shift_start, bootstrap?.employee?.shift_end)}
          </AppText>
        ) : null}
      </Card>

      {isEmployee ? (
        <>
          <View className="mt-4">
            <SyncStrip />
          </View>

          <SectionTitle title="Shift & device" />
          <Card className="p-0">
            <SettingRow
              icon={<MapPin size={17} color="#7CB4FF" />}
              title="Location permission"
              value={
                permission.foreground && permission.background
                  ? "Always allowed"
                  : permission.foreground
                    ? "While using only"
                    : "Not allowed"
              }
              tone={permission.foreground && permission.background ? "ok" : "warn"}
              onPress={fixLocation}
            />
            <Divider />
            <SettingRow
              icon={<Fingerprint size={17} color="#22D3EE" />}
              title="Enrolled devices"
              value={`${bootstrap?.enrollment.devices.length || 0} on this account`}
              onPress={() => router.push("/device")}
            />
            <Divider />
            <SettingRow
              icon={<ShieldCheck size={17} color="#34D399" />}
              title="Tracking consent"
              value={bootstrap?.tracking.consent ? "Granted" : "Not granted"}
              tone={bootstrap?.tracking.consent ? "ok" : "warn"}
              onPress={withdrawConsent}
            />
          </Card>

          <SectionTitle title="Notifications" />
          <Card className="p-0">
            <SettingRow
              icon={<Bell size={17} color="#FBBF24" />}
              title="Push notifications"
              value={
                bootstrap?.push.registered
                  ? "Registered"
                  : notifications
                    ? "Permission granted"
                    : "Not enabled"
              }
              tone={bootstrap?.push.registered ? "ok" : "neutral"}
              onPress={enableNotifications}
            />
          </Card>

          {active ? (
            <Card className="mt-4 flex-row items-center gap-3 border-ok/20 bg-ok/[0.04]">
              <View className="h-9 w-9 items-center justify-center rounded-xl bg-ok/15">
                <MapPin size={16} color="#34D399" />
              </View>
              <View className="flex-1">
                <AppText className="text-[12px] font-semibold text-ok">Shift tracking is on</AppText>
                <AppText className="mt-0.5 text-[10px] text-faint">
                  {pending ? `${pending} record${pending === 1 ? "" : "s"} waiting` : "Everything synced"}
                </AppText>
              </View>
              <Button
                size="sm"
                variant="secondary"
                onPress={async () => {
                  await stop();
                  await refresh();
                }}
              >
                Stop
              </Button>
            </Card>
          ) : null}
        </>
      ) : null}

      {isAdmin ? (
        <>
          <SectionTitle title="Manage" />
          <Card className="p-0">
            <SettingRow
              icon={<CalendarCheck2 size={17} color="#FBBF24" />}
              title="Leave approvals"
              value="Review requests"
              onPress={() => router.push("/approvals")}
            />
            <Divider />
            <SettingRow
              icon={<UserRound size={17} color="#7CB4FF" />}
              title="Team directory"
              onPress={() => router.push("/(tabs)/team")}
            />
            <Divider />
            <SettingRow
              icon={<MapPin size={17} color="#22D3EE" />}
              title="Live positions"
              onPress={() => router.push("/(tabs)/map")}
            />
          </Card>
        </>
      ) : null}

      <SectionTitle title="About" />
      <Card className="p-0">
        <SettingRow
          icon={<ShieldCheck size={17} color="#8FA6C0" />}
          title="Privacy notice"
          value="How field data is used"
          onPress={openPrivacy}
        />
        <Divider />
        <SettingRow
          icon={<Info size={17} color="#8FA6C0" />}
          title="App version"
          value={APP_VERSION}
        />
        <Divider />
        <SettingRow
          icon={<SlidersHorizontal size={17} color="#8FA6C0" />}
          title="Sync queue"
          value={lastSync ? "View storage" : "Nothing waiting"}
          onPress={() =>
            setError(
              pending
                ? `${pending} records are stored on this phone and will upload automatically.`
                : "The local queue is empty."
            )
          }
        />
      </Card>

      {error ? (
        <Card className="mt-4 border-warn/25 bg-warn/[0.05]">
          <AppText className="text-[12px] leading-5 text-warn">{error}</AppText>
        </Card>
      ) : null}

      <Button
        variant="danger"
        size="lg"
        className="mt-5"
        loading={working}
        onPress={logout}
        leftIcon={<LogOut size={17} color="#FB7185" />}
      >
        Sign out
      </Button>

      <AppText variant="tiny" className="mb-4 mt-5 text-center normal-case tracking-normal">
        Fleet Console Field · {APP_VERSION}
      </AppText>
    </ScreenScroll>
  );
}

function SectionTitle({ title }: { title: string }) {
  return (
    <View className="mb-2 mt-6">
      <AppText variant="tiny">{title}</AppText>
    </View>
  );
}

function SettingRow({
  icon,
  title,
  value,
  tone,
  onPress,
}: {
  icon: React.ReactNode;
  title: string;
  value?: string;
  tone?: "ok" | "warn" | "neutral";
  onPress?: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      className="flex-row items-center gap-3 px-4 py-3.5 active:bg-raised/50"
    >
      <View className="h-9 w-9 items-center justify-center rounded-xl bg-raised">{icon}</View>
      <View className="flex-1">
        <AppText className="text-[13px] font-medium">{title}</AppText>
        {value ? (
          <AppText
            className={
              tone === "ok"
                ? "mt-0.5 text-[10px] text-ok"
                : tone === "warn"
                  ? "mt-0.5 text-[10px] text-warn"
                  : "mt-0.5 text-[10px] text-faint"
            }
          >
            {value}
          </AppText>
        ) : null}
      </View>
      {onPress ? <ChevronRight size={16} color="#5E7693" /> : null}
    </Pressable>
  );
}
