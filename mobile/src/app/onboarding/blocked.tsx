import { useRouter } from "expo-router";
import { ShieldAlert } from "lucide-react-native";
import { View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { LogoMark } from "@/components/logo";
import { AppText } from "@/components/ui/app-text";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useAuth } from "@/providers/auth-provider";

export default function BlockedScreen() {
  const router = useRouter();
  const { signOut } = useAuth();

  return (
    <SafeAreaView className="flex-1 bg-canvas" edges={["top", "bottom"]}>
      <View className="flex-1 justify-between px-6 pb-8 pt-4">
        <LogoMark size={38} />
        <View className="items-center">
          <View className="mb-5 h-20 w-20 items-center justify-center rounded-[26px] border border-danger/25 bg-danger/10">
            <ShieldAlert size={34} color="#FB7185" />
          </View>
          <AppText variant="heading" className="text-center">This phone was revoked</AppText>
          <AppText variant="muted" className="mt-3 max-w-[310px] text-center">
            An administrator signed this device out of Fleet Console. Re-enrollment
            is locked to protect your account.
          </AppText>
          <Card className="mt-6 border-danger/20 bg-danger/[0.04]">
            <AppText variant="small" className="text-center">
              Contact your administrator and ask them to allow a new device
              enrollment. Once enabled, sign in again and this screen will unlock.
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
