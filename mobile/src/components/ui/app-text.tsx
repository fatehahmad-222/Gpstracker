import { Text, type TextProps } from "react-native";

import { cn } from "@/lib/cn";

type Variant =
  | "body"
  | "muted"
  | "small"
  | "tiny"
  | "label"
  | "title"
  | "heading"
  | "display"
  | "mono";

const variants: Record<Variant, string> = {
  body: "text-[15px] leading-6 text-ink font-sans",
  muted: "text-[14px] leading-5 text-dim font-sans",
  small: "text-[13px] leading-5 text-dim font-sans",
  tiny: "text-[11px] leading-4 text-faint font-medium uppercase tracking-[1.2px]",
  label: "text-[13px] leading-5 text-ink font-semibold",
  title: "text-[20px] leading-7 text-ink font-bold tracking-[-0.3px]",
  heading: "text-[26px] leading-8 text-ink font-bold tracking-[-0.6px]",
  display: "text-[34px] leading-[40px] text-ink font-display tracking-[-1px]",
  mono: "text-[12px] leading-5 text-dim font-medium tracking-[0.3px]",
};

export function AppText({
  variant = "body",
  className,
  ...props
}: TextProps & { variant?: Variant; className?: string }) {
  return <Text className={cn(variants[variant], className)} {...props} />;
}
