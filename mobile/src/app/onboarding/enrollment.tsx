import { useRouter } from "expo-router";
import * as SecureStore from "expo-secure-store";
import { CheckCircle2, Fingerprint, LockKeyhole, ShieldCheck, Smartphone } from "lucide-react-native";
import { useEffect, useState } from "react";
import { ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { LogoMark } from "@/components/logo";
import { AppText } from "@/components/ui/app-text";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { apiRequest, errorMessage } from "@/lib/api";
import { STORAGE_KEYS } from "@/lib/constants";
import { getDeviceId, getDeviceInfo, getDeviceLabel } from "@/lib/device";
import { registerPushToken } from "@/lib/notifications";
import { clearRevokedFlag } from "@/lib/tracking/queue";
import { useApp } from "@/providers/app-provider";

type EnrollResponse = {
  token: string;
  employee: { id: string; name: string; emp_code: string };
};

export default function EnrollmentScreen() {
  const router = useRouter();
  const { bootstrap, refresh } = useApp();
  const [label, setLabel] = useState("This phone");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enrolled, setEnrolled] = useState(false);

  useEffect(() => {
    getDeviceLabel().then(setLabel).catch(() => undefined);
  }, []);

  const enroll = async () => {
    setLoading(true);
    setError(null);
    try {
      const [deviceId, device] = await Promise.all([getDeviceId(), getDeviceInfo()]);
      const response = await apiRequest<EnrollResponse>("/api/app/device-enroll", {
        method: "POST",
        body: { device_id: deviceId, label, device },
      });

      await SecureStore.setItemAsync(STORAGE_KEYS.deviceToken, response.token);
      await clearRevokedFlag();
      setEnrolled(true);

      try {
        await registerPushToken();
      } catch {
        // Notifications can be enabled later from More.
      }

      await refresh();
      setTimeout(() => router.replace("/"), 650);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-canvas" edges={["top", "bottom"]}>
      <ScrollView contentContainerClassName="px-6 pb-8 pt-4" showsVerticalScrollIndicator={false}>
        <View className="mb-7 flex-row items-center justify-between">
          <LogoMark size={38} />
          <View className="rounded-full border border-line bg-surface px-3 py-1.5">
            <AppText className="text-[10px] font-semibold uppercase tracking-[1.5px] text-faint">
              Step 2 of 2
            </AppText>
          </View>
        </View>

        <AppText variant="tiny" className="mb-2">One phone, one identity</AppText>
        <AppText variant="display">Enroll this{"\n"}device.</AppText>
        <AppText variant="muted" className="mt-4 text-[15px]">
          Your assigned work and shift data are tied to this handset. Enrolling a
          second phone is blocked unless an administrator allows it.
        </AppText>

        <Card className="mt-7 items-center p-6">
          <View className="relative mb-4">
            <View className="h-20 w-20 items-center justify-center rounded-[26px] border border-brand/30 bg-brand/10">
              <Smartphone size={34} color="#7CB4FF" />
            </View>
            <View className="absolute -bottom-1 -right-1 h-8 w-8 items-center justify-center rounded-full border-4 border-surface bg-ok">
              <CheckCircle2 size={14} color="#07111F" />
            </View>
          </View>
          <AppText variant="title">{label}</AppText>
          <AppText variant="small" className="mt-1 text-center">
            {bootstrap?.employee?.name} · {bootstrap?.employee?.emp_code}
          </AppText>

          <View className="mt-5 w-full gap-3 rounded-2xl border border-line bg-canvas p-3.5">
            <View className="flex-row items-center gap-3">
              <Fingerprint size={16} color="#8FA6C0" />
              <View className="flex-1">
                <AppText className="text-[12px] font-medium">Hardware-bound device ID</AppText>
                <AppText className="text-[10px] text-faint">Survives an app reinstall</AppText>
              </View>
            </View>
            <View className="h-px bg-line" />
            <View className="flex-row items-center gap-3">
              <LockKeyhole size={16} color="#8FA6C0" />
              <View className="flex-1">
                <AppText className="text-[12px] font-medium">Encrypted device credential</AppText>
                <AppText className="text-[10px] text-faint">Stored in the phone keychain</AppText>
              </View>
            </View>
          </View>
        </Card>

        <View className="mt-4 flex-row gap-2 rounded-2xl border border-cyan/20 bg-cyan/[0.04] p-3.5">
          <ShieldCheck size={17} color="#22D3EE" />
          <AppText variant="small" className="flex-1">
            Enrolling does not start tracking. You still control the shift from Home.
          </AppText>
        </View>

        {error ? (
          <Card className="mt-4 border-danger/25 bg-danger/[0.06]">
            <AppText className="text-[12px] leading-5 text-danger">{error}</AppText>
          </Card>
        ) : null}

        {enrolled ? (
          <Card className="mt-5 items-center border-ok/25 bg-ok/[0.06] py-5">
            <CheckCircle2 size={26} color="#34D399" />
            <AppText className="mt-2 font-semibold text-ok">Device enrolled</AppText>
          </Card>
        ) : (
          <Button
            size="lg"
            className="mt-6"
            loading={loading}
            onPress={enroll}
            leftIcon={<ShieldCheck size={18} color="#FFFFFF" />}
          >
            Enroll this phone
          </Button>
        )}

        <AppText variant="tiny" className="mt-5 text-center leading-5">
          If this phone was revoked, ask your administrator to allow re-enrollment
        </AppText>
      </ScrollView>
    </SafeAreaView>
  );
}
