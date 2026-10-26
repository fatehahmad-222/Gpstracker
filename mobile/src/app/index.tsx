import { Redirect } from "expo-router";

import { LoadingState } from "@/components/ui/screen";
import { isConfigured, missingConfig } from "@/lib/env";
import { useApp } from "@/providers/app-provider";

export default function Index() {
  const { stage } = useApp();

  if (!isConfigured) {
    return (
      <LoadingState
        label={`Missing configuration: ${missingConfig.join(", ")}`}
      />
    );
  }

  switch (stage) {
    case "login":
      return <Redirect href="/login" />;
    case "unlinked":
      return <Redirect href="/onboarding/unlinked" />;
    case "consent":
      return <Redirect href="/onboarding/consent" />;
    case "enrollment":
      return <Redirect href="/onboarding/enrollment" />;
    case "blocked":
      return <Redirect href="/onboarding/blocked" />;
    case "main":
      return <Redirect href="/(tabs)/home" />;
    default:
      return <LoadingState label="Opening your workspace" />;
  }
}
