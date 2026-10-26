import { ActivityIndicator, Pressable, Text, View, type PressableProps } from "react-native";

import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "success" | "dark";
type Size = "sm" | "md" | "lg";

const variants: Record<Variant, { box: string; text: string }> = {
  primary: { box: "bg-brand border-brand", text: "text-white" },
  secondary: { box: "bg-raised border-line", text: "text-ink" },
  ghost: { box: "bg-transparent border-transparent", text: "text-dim" },
  danger: { box: "bg-danger/15 border-danger/40", text: "text-danger" },
  success: { box: "bg-ok/15 border-ok/40", text: "text-ok" },
  dark: { box: "bg-canvas border-line", text: "text-ink" },
};

const sizes: Record<Size, { box: string; text: string }> = {
  sm: { box: "h-9 px-3 rounded-xl", text: "text-[13px]" },
  md: { box: "h-11 px-4 rounded-2xl", text: "text-[14px]" },
  lg: { box: "h-14 px-5 rounded-2xl", text: "text-[16px]" },
};

export function Button({
  children,
  variant = "primary",
  size = "md",
  loading,
  leftIcon,
  rightIcon,
  className,
  textClassName,
  disabled,
  ...props
}: PressableProps & {
  children: React.ReactNode;
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  className?: string;
  textClassName?: string;
}) {
  const style = variants[variant];
  const dimension = sizes[size];
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled || loading}
      className={cn(
        "flex-row items-center justify-center gap-2 border active:opacity-80",
        style.box,
        dimension.box,
        (disabled || loading) && "opacity-50",
        className
      )}
      {...props}
    >
      {loading ? (
        <ActivityIndicator size="small" color={variant === "primary" ? "#fff" : "#8FA6C0"} />
      ) : (
        leftIcon
      )}
      {typeof children === "string" ? (
        <Text className={cn("font-semibold", style.text, dimension.text, textClassName)}>
          {children}
        </Text>
      ) : (
        children
      )}
      {!loading && rightIcon ? <View>{rightIcon}</View> : null}
    </Pressable>
  );
}
