import { Eye, EyeOff } from "lucide-react-native";
import { useState, type ReactNode } from "react";
import { Pressable, TextInput, View, type TextInputProps } from "react-native";

import { cn } from "@/lib/cn";
import { AppText } from "./app-text";

export function TextField({
  label,
  error,
  hint,
  leftIcon,
  className,
  secureTextEntry,
  ...props
}: TextInputProps & {
  label?: string;
  error?: string;
  hint?: string;
  leftIcon?: ReactNode;
  className?: string;
}) {
  const [visible, setVisible] = useState(false);
  const isPassword = Boolean(secureTextEntry);

  return (
    <View className={cn("gap-2", className)}>
      {label ? <AppText variant="label">{label}</AppText> : null}
      <View
        className={cn(
          "flex-row items-center gap-3 rounded-2xl border bg-surface px-4",
          error ? "border-danger/60" : "border-line"
        )}
      >
        {leftIcon}
        <TextInput
          className="h-13 flex-1 py-3.5 font-sans text-[15px] text-ink"
          placeholderTextColor="#5E7693"
          secureTextEntry={isPassword && !visible}
          selectionColor="#3B82F6"
          {...props}
        />
        {isPassword ? (
          <Pressable onPress={() => setVisible((value) => !value)} hitSlop={10}>
            {visible ? <EyeOff size={19} color="#8FA6C0" /> : <Eye size={19} color="#8FA6C0" />}
          </Pressable>
        ) : null}
      </View>
      {error ? <AppText className="text-[12px] text-danger">{error}</AppText> : null}
      {!error && hint ? <AppText variant="small">{hint}</AppText> : null}
    </View>
  );
}
