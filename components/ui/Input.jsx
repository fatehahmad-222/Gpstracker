import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export const Input = forwardRef(function Input(
  { className, type = "text", ...props },
  ref
) {
  return (
    <input
      ref={ref}
      type={type}
      className={cn(
        "w-full rounded-field border border-line bg-bg px-3.5 py-2.5 text-sm text-ink",
        "placeholder:text-ink-dim/60 focus:border-accent focus:outline-none",
        "focus:ring-2 focus:ring-accent/25 disabled:opacity-50 transition-colors",
        className
      )}
      {...props}
    />
  );
});

export function Textarea({ className, rows = 3, ...props }) {
  return (
    <textarea
      rows={rows}
      className={cn(
        "w-full resize-none rounded-field border border-line bg-bg px-3.5 py-2.5 text-sm text-ink",
        "placeholder:text-ink-dim/60 focus:border-accent focus:outline-none",
        "focus:ring-2 focus:ring-accent/25 transition-colors",
        className
      )}
      {...props}
    />
  );
}
