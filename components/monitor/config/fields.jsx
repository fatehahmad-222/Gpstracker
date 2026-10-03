"use client";

import { cn } from "@/lib/utils";

/**
 * Shared form primitives for the Configuration screens.
 *
 * Kept in their own module (rather than inside OrgUnitManager) so the policy
 * form can use the same field markup without importing the org-unit screen.
 */

export function Field({ label, hint, error, required, children }) {
  return (
    <label className="block">
      <span className="mb-1 flex items-center gap-1.5 text-label font-semibold uppercase text-ink-dim">
        {label}
        {required ? <span className="text-crit">*</span> : null}
      </span>
      {children}
      {error ? (
        <span role="alert" className="mt-1 block text-[11.5px] font-medium text-crit">
          {error}
        </span>
      ) : hint ? (
        <span className="mt-1 block text-[11px] text-ink-dim">{hint}</span>
      ) : null}
    </label>
  );
}

export function inputClass(hasError = false) {
  return cn(
    "w-full rounded-lg border bg-surface px-3 py-2 text-[13px] text-ink outline-none transition",
    "focus:ring-2 focus:ring-brand/40",
    "disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-ink-dim",
    hasError ? "border-crit focus:border-crit" : "border-line focus:border-brand"
  );
}