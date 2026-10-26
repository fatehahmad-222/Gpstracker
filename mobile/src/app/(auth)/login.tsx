import { useRouter } from "expo-router";
import { AlertCircle, ArrowRight, LockKeyhole, Mail } from "lucide-react-native";
import { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Wordmark } from "@/components/logo";
import { AppText } from "@/components/ui/app-text";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { TextField } from "@/components/ui/text-field";
import { missingConfig } from "@/lib/env";
import { useAuth } from "@/providers/auth-provider";

export default function LoginScreen() {
  const router = useRouter();
  const { signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!email.trim() || !password) {
      setError("Enter your work email and password.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await signIn(email, password);
      router.replace("/");
    } catch (err) {
      const message = (err as Error)?.message || "Could not sign in";
      setError(
        /invalid login credentials/i.test(message)
          ? "That email and password do not match."
          : message
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-canvas" edges={["top", "bottom"]}>
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerClassName="flex-grow px-6 pb-8 pt-6"
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View className="flex-1 justify-between">
            <View>
              <View className="mb-10 flex-row items-center justify-between">
                <Wordmark />
                <View className="rounded-full border border-line bg-surface px-3 py-1.5">
                  <AppText className="text-[10px] font-semibold uppercase tracking-[1.5px] text-faint">
                    Field app
                  </AppText>
                </View>
              </View>

              <View className="mb-8">
                <AppText variant="display">Your shift,{"\n"}in your pocket.</AppText>
                <AppText variant="muted" className="mt-4 max-w-[310px] text-[15px]">
                  Attendance, assigned work and live field position for the team
                  you run — and the shift you work.
                </AppText>
              </View>

              {missingConfig.length ? (
                <Card className="mb-5 border-warn/30 bg-warn/[0.06]">
                  <View className="flex-row gap-3">
                    <AlertCircle size={18} color="#FBBF24" />
                    <View className="flex-1">
                      <AppText className="font-semibold text-warn">Setup required</AppText>
                      <AppText variant="small" className="mt-1">
                        Add {missingConfig.join(", ")} to mobile/.env, then restart Expo.
                      </AppText>
                    </View>
                  </View>
                </Card>
              ) : null}

              <Card className="gap-4 rounded-[28px] p-5">
                <TextField
                  label="Work email"
                  value={email}
                  onChangeText={setEmail}
                  placeholder="you@company.com"
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="email"
                  keyboardType="email-address"
                  leftIcon={<Mail size={18} color="#5E7693" />}
                />
                <TextField
                  label="Password"
                  value={password}
                  onChangeText={setPassword}
                  placeholder="Your Fleet Console password"
                  autoCapitalize="none"
                  autoComplete="password"
                  secureTextEntry
                  onSubmitEditing={submit}
                  returnKeyType="go"
                  leftIcon={<LockKeyhole size={18} color="#5E7693" />}
                />

                {error ? (
                  <View className="flex-row items-start gap-2 rounded-xl border border-danger/25 bg-danger/[0.07] p-3">
                    <AlertCircle size={16} color="#FB7185" />
                    <AppText className="flex-1 text-[12px] leading-5 text-danger">{error}</AppText>
                  </View>
                ) : null}

                <Button
                  size="lg"
                  loading={loading}
                  onPress={submit}
                  rightIcon={<ArrowRight size={18} color="#FFFFFF" />}
                >
                  Sign in
                </Button>
              </Card>

              <View className="mt-5 flex-row items-center justify-center gap-1">
                <AppText variant="small">Need access?</AppText>
                <Pressable
                  onPress={() =>
                    setError("Ask your Fleet Console administrator to invite your work email.")
                  }
                >
                  <AppText className="text-[13px] font-semibold text-[#7CB4FF]">
                    Contact your admin
                  </AppText>
                </Pressable>
              </View>
            </View>

            <View className="mt-12 items-center gap-2">
              <View className="h-1 w-10 rounded-full bg-line" />
              <AppText variant="tiny" className="text-center">
                Location is recorded only during an active shift
              </AppText>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
