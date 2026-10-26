import { Image } from "expo-image";
import { View } from "react-native";

import { cn } from "@/lib/cn";
import { initials } from "@/lib/format";
import { AppText } from "./app-text";

export function Avatar({
  name,
  uri,
  size = 42,
  className,
}: {
  name?: string | null;
  uri?: string | null;
  size?: number;
  className?: string;
}) {
  return (
    <View
      className={cn(
        "items-center justify-center overflow-hidden rounded-full border border-line bg-raised",
        className
      )}
      style={{ width: size, height: size }}
    >
      {uri ? (
        <Image
          source={{ uri }}
          style={{ width: size, height: size }}
          contentFit="cover"
          alt=""
        />
      ) : (
        <AppText className="font-bold text-cyan" style={{ fontSize: size * 0.34 }}>
          {initials(name)}
        </AppText>
      )}
    </View>
  );
}
