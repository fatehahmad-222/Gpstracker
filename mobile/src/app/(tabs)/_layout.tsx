import { Redirect, Tabs } from "expo-router";
import {
  BellRing,
  CalendarDays,
  ClipboardList,
  Home,
  Map,
  Settings2,
  Timer,
  Users,
} from "lucide-react-native";
import { Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { LoadingState } from "@/components/ui/screen";
import { useApp } from "@/providers/app-provider";

export default function TabsLayout() {
  const { stage, isAdmin } = useApp();
  const insets = useSafeAreaInsets();

  if (stage === "loading") return <LoadingState label="Loading your workspace" />;
  if (stage !== "main") return <Redirect href="/" />;

  const bottom = Math.max(insets.bottom, Platform.OS === "android" ? 10 : 4);

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: "#7CB4FF",
        tabBarInactiveTintColor: "#5E7693",
        tabBarLabelStyle: {
          fontFamily: "Inter_500Medium",
          fontSize: 10,
          marginTop: 1,
        },
        tabBarStyle: {
          height: 58 + bottom,
          paddingTop: 6,
          paddingBottom: bottom,
          backgroundColor: "#0A1626",
          borderTopColor: "#1E334D",
          borderTopWidth: 1,
        },
        tabBarItemStyle: { paddingTop: 2 },
        sceneStyle: { backgroundColor: "#07111F" },
      }}
    >
      <Tabs.Screen
        name="home"
        options={{
          title: isAdmin ? "Overview" : "Home",
          tabBarIcon: ({ color, size }) => <Home size={size - 2} color={color} />,
        }}
      />
      <Tabs.Screen
        name="team"
        options={{
          title: "Team",
          href: isAdmin ? undefined : null,
          tabBarIcon: ({ color, size }) => <Users size={size - 2} color={color} />,
        }}
      />
      <Tabs.Screen
        name="map"
        options={{
          title: "Live map",
          href: isAdmin ? undefined : null,
          tabBarIcon: ({ color, size }) => <Map size={size - 2} color={color} />,
        }}
      />
      <Tabs.Screen
        name="alerts"
        options={{
          title: "Alerts",
          href: isAdmin ? undefined : null,
          tabBarIcon: ({ color, size }) => <BellRing size={size - 2} color={color} />,
        }}
      />
      <Tabs.Screen
        name="tasks"
        options={{
          title: "Tasks",
          href: isAdmin ? null : undefined,
          tabBarIcon: ({ color, size }) => <ClipboardList size={size - 2} color={color} />,
        }}
      />
      <Tabs.Screen
        name="attendance"
        options={{
          title: "Attendance",
          href: isAdmin ? null : undefined,
          tabBarIcon: ({ color, size }) => <Timer size={size - 2} color={color} />,
        }}
      />
      <Tabs.Screen
        name="leave"
        options={{
          title: "Leave",
          href: isAdmin ? null : undefined,
          tabBarIcon: ({ color, size }) => <CalendarDays size={size - 2} color={color} />,
        }}
      />
      <Tabs.Screen
        name="more"
        options={{
          title: "More",
          tabBarIcon: ({ color, size }) => <Settings2 size={size - 2} color={color} />,
        }}
      />
    </Tabs>
  );
}
