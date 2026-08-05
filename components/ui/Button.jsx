"use client";

import Link from "next/link";
import { forwardRef } from "react";
import { cn } from "@/lib/utils";

const styles = {
  primary: "bg-accent text-bg hover:bg-accent-strong",
  secondary:
    "bg-surface-2 text-ink border border-line hover:bg-surface-3",
  ghost: "text-ink-dim hover:text-ink hover:bg-surface-2",
  danger:
    "bg-danger/10 text-danger border border-danger/30 hover:bg-danger/20",
  outline: "border border-line text-ink hover:bg-surface-2",
};

const sizes = {
  xs: "h-7 px-2.5 text-xs gap-1.5",
  sm: "h-8 px-3 text-sm gap-1.5",
  md: "h-10 px-4 text-sm gap-2",
  lg: "h-11 px-5 text-base gap-2",
};

export const Button = forwardRef(function Button(
  { variant = "primary", size = "md", className, href, children, disabled, ...props },
  ref
) {
  const classes = cn(
    "inline-flex items-center justify-center rounded-field font-medium transition-all duration-150",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
    "disabled:pointer-events-none disabled:opacity-50 active:scale-[0.98]",
    styles[variant],
    sizes[size],
    className
  );

  if (href) {
    return (
      <Link ref={ref} href={href} className={classes} {...props}>
        {children}
      </Link>
    );
  }

  return (
    <button ref={ref} className={classes} disabled={disabled} {...props}>
      {children}
    </button>
  );
});
