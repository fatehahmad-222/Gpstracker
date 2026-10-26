import { useRouter } from "expo-router";
import {
  BatteryMedium,
  EyeOff,
  MapPin,
  ShieldCheck,
  TimerReset,
  WifiOff,
} from "lucide-react-native";
import { useState } from "react";
import { Linking, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { LogoMark } from "@/components/logo";
import { AppText } from "@/components/ui/app-text";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { apiRequest, errorMessage } from "@/lib/api";
import { env } from "@/lib/env";
import { requestNotificationPermission } from "@/lib/notifications";
import { requestLocationPermissions } from "@/lib/tracking/controller";
import { useApp } from "@/providers/app-provider";
import { useAuth } from "@/providers/auth-provider";

const points = [
  {
    icon: MapPin,
    title: "Location during a shift",
    body: "Recorded at your company's configured interval while you have a shift running, including when the screen is off.",
  },
  {
    icon: TimerReset,
    title: "Start and stop are yours",
    body: "Tracking stops when you end the shift. The persistent notification makes an active shift impossible to miss.",
  },
  {
    icon: BatteryMedium,
    title: "Device health, not personal data",
    body: "Battery, connectivity and mock-location signals help keep field data trustworthy. Contacts, photos and messages are never read.",
  },
  {
    icon: WifiOff,
    title: "Offline-safe",
    body: "Locations wait on this phone in an encrypted app queue and sync when you reconnect. Nothing is silently discarded.",
  },
];

export default function ConsentScreen() {
  const router = useRouter();
  const { bootstrap, refresh } = useApp();
  const { signOut } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const accept = async () => {
    setLoading(true);
    setError(null);
    try {
      await apiRequest("/api/app/tracking-consent", {
        method: "POST",
        body: { consent: true },
      });

      await requestLocationPermissions();
      await requestNotificationPermission();
      await refresh();
      router.replace("/");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const decline = async () => {
    await signOut();
    router.replace("/login");
  };

  return (
    <SafeAreaView className="flex-1 bg-canvas" edges={["top", "bottom"]}>
      <ScrollView
        contentContainerClassName="px-6 pb-8 pt-4"
        showsVerticalScrollIndicator={false}
      >
        <View className="mb-7 flex-row items-center justify-between">
          <LogoMark size={38} />
          <View className="rounded-full border border-line bg-surface px-3 py-1.5">
            <AppText className="text-[10px] font-semibold uppercase tracking-[1.5px] text-faint">
              Step 1 of 2
            </AppText>
          </View>
        </View>

        <AppText variant="tiny" className="mb-2">Transparent by design</AppText>
        <AppText variant="display">Before tracking{"\n"}starts.</AppText>
        <AppText variant="muted" className="mt-4 text-[15px]">
          Hi {bootstrap?.employee?.name?.split(" ")[0] || "there"}. Fleet Console
          records your work location so attendance and field operations stay
          accurate. Here is exactly what that means.
        </AppText>

        <View className="mt-7 gap-3">
          {points.map((point) => (
            <Card key={point.title} className="flex-row gap-3.5 p-4">
              <View className="mt-0.5 h-10 w-10 items-center justify-center rounded-2xl bg-brand/12">
                <point.icon size={18} color="#7CB4FF" />
              </View>
              <View className="flex-1">
                <AppText className="font-semibold">{point.title}</AppText>
                <AppText variant="small" className="mt-1">{point.body}</AppText>
              </View>
            </Card>
          ))}
        </View>

        <Card className="mt-4 border-cyan/20 bg-cyan/[0.04]">
          <View className="flex-row gap-3">
            <EyeOff size={18} color="#22D3EE" />
            <View className="flex-1">
              <AppText className="font-semibold text-cyan">Not continuous surveillance</AppText>
              <AppText variant="small" className="mt-1">
                There is no tracking outside a shift you start. You can stop at any
                time, and withdrawing consent disables this phone until an admin
                re-enrolls it.
              </AppText>
            </View>
          </View>
        </Card>

        {error ? (
          <AppText className="mt-4 text-center text-[12px] text-danger">{error}</AppText>
        ) : null}

        <Button
          size="lg"
          className="mt-6"
          loading={loading}
          onPress={accept}
          leftIcon={<ShieldCheck size={18} color="#FFFFFF" />}
        >
          Accept & allow location
        </Button>

        <View className="mt-3 flex-row items-center justify-center gap-1">
          <AppText variant="small">Read the</AppText>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 px-1"
            onPress={() => {
              if (env.privacyUrl) Linking.openURL(env.privacyUrl);
              else setError("Your administrator has not published a privacy policy link yet.");
            }}
          >
            privacy notice
          </Button>
        </View>

        <Button variant="ghost" className="mt-2" onPress={decline}>
          I do not consent
        </Button>
      </ScrollView>
    </SafeAreaView>
  );
}
