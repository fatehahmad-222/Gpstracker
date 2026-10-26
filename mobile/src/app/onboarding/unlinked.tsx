import { useRouter } from "expo-router";
import { UserRoundX } from "lucide-react-native";
import { View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { LogoMark } from "@/components/logo";
import { AppText } from "@/components/ui/app-text";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useApp } from "@/providers/app-provider";
import { useAuth } from "@/providers/auth-provider";

export default function UnlinkedScreen() {
  const router = useRouter();
  const { signOut } = useAuth();
  const { bootstrap } = useApp();

  return (
    <SafeAreaView className="flex-1 bg-canvas" edges={["top", "bottom"]}>
      <View className="flex-1 justify-between px-6 pb-8 pt-4">
        <LogoMark size={38} />
        <View className="items-center">
          <View className="mb-5 h-20 w-20 items-center justify-center rounded-[26px] border border-warn/25 bg-warn/10">
            <UserRoundX size={34} color="#FBBF24" />
          </View>
          <AppText variant="heading" className="text-center">No employee record yet</AppText>
          <AppText variant="muted" className="mt-3 max-w-[310px] text-center">
            This login is not linked to an active employee in{" "}
            {bootstrap?.company?.id ? "this company" : "Fleet Console"}. Ask your
            administrator to add your work email to your employee profile.
          </AppText>
          <Card className="mt-6 w-full">
            <AppText variant="tiny" className="mb-1">Signed in as</AppText>
            <AppText className="font-medium">{bootstrap?.employee?.name || "Your account"}</AppText>
            <AppText variant="small" className="mt-1">
              Role: {bootstrap?.role || "unknown"}
            </AppText>
          </Card>
        </View>
        <Button
          size="lg"
          variant="secondary"
          onPress={async () => {
            await signOut();
            router.replace("/login");
          }}
        >
          Sign out
        </Button>
      </View>
    </SafeAreaView>
  );
}
