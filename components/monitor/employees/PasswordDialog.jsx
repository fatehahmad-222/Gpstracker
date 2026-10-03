"use client";

import { useMemo, useState } from "react";
import { Eye, EyeOff, KeyRound, X } from "lucide-react";

import { api, ApiError } from "@/lib/monitor/client";
import { Field, inputClass } from "@/components/monitor/config/fields";
import { passwordChecklist } from "@/lib/monitor/validation";
import { cn } from "@/lib/utils";

/**
 * Reset an employee's tracker app password.
 *
 * Its own dialog rather than a field on the form: the password is stored as a
 * scrypt hash, so it can never be shown again and changing it should be a
 * deliberate action with its own audit entry.
 */
export function PasswordDialog({ employee, onClose, onReset }) {
  const [values, setValues] = useState({ app_password: "", confirm: "" });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [reveal, setReveal] = useState(false);

  const checklist = useMemo(() => passwordChecklist(values.app_password), [values.app_password]);
  const allOk = checklist.every((r) => r.ok);
  const matches = values.app_password.length > 0 && values.app_password === values.confirm;

  const set = (key) => (e) => {
    setValues((v) => ({ ...v, [key]: e.target.value }));
    setErrors((prev) => (prev[key] ? { ...prev, [key]: undefined } : prev));
  };

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setErrors({});

    if (values.app_password !== values.confirm) {
      setErrors({ confirm: "The two passwords do not match" });
      setBusy(false);
      return;
    }

    try {
      await api.post(`/api/monitor/employees/${employee.id}/password`, {
        app_password: values.app_password,
      });
      onReset(`The app password for ${employee.name} was reset.`);
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrors(err.fields);
      else setErrors({ _form: err.message || "Could not reset this password" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="reset-password-title"
    >
      <form
        onSubmit={submit}
        className="w-full max-w-md rounded-2xl border border-line bg-surface p-5 shadow-xl"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <KeyRound size={16} className="mt-0.5 text-brand" aria-hidden="true" />
            <div>
              <h2 id="reset-password-title" className="text-[15px] font-semibold text-ink">
                Reset app password
              </h2>
              <p className="mt-0.5 text-[12px] text-ink-dim">
                {employee.name} ({employee.emp_code}) signs in to the tracker app with this. It is
                stored hashed and cannot be shown again.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1 text-ink-dim transition hover:bg-surface-2 hover:text-ink"
          >
            <X size={15} />
          </button>
        </div>

        <div className="mt-4 space-y-3">
          <Field label="New password" required error={errors.app_password}>
            <div className="relative">
              <input
                type={reveal ? "text" : "password"}
                value={values.app_password}
                onChange={set("app_password")}
                autoComplete="new-password"
                className={cn(inputClass(Boolean(errors.app_password)), "pr-9 font-mono")}
              />
              <button
                type="button"
                onClick={() => setReveal((v) => !v)}
                aria-label={reveal ? "Hide password" : "Show password"}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-ink-dim transition hover:text-ink"
              >
                {reveal ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </Field>

          <ul className="grid grid-cols-2 gap-x-3">
            {checklist.map((rule) => (
              <li key={rule.key} className={cn("text-[11px]", rule.ok ? "text-ok" : "text-ink-dim")}>
                {rule.ok ? "✓" : "○"} {rule.label}
              </li>
            ))}
          </ul>

          <Field label="Confirm password" required error={errors.confirm}>
            <input
              type={reveal ? "text" : "password"}
              value={values.confirm}
              onChange={set("confirm")}
              autoComplete="new-password"
              className={cn(inputClass(Boolean(errors.confirm)), "font-mono")}
            />
          </Field>

          {values.confirm && !matches ? (
            <p role="alert" className="text-[11.5px] font-medium text-crit">
              The two passwords do not match.
            </p>
          ) : null}

          {errors._form ? (
            <p role="alert" className="text-[12px] font-medium text-crit">
              {errors._form}
            </p>
          ) : null}
        </div>

        <div className="mt-5 flex gap-2">
          <button
            type="submit"
            disabled={busy || !allOk || !matches}
            className="rounded-pill bg-brand px-4 py-2 text-[12.5px] font-semibold text-white transition hover:bg-brand-strong disabled:opacity-50"
          >
            {busy ? "Resetting…" : "Reset password"}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-pill border border-line bg-surface px-4 py-2 text-[12.5px] font-semibold text-ink-dim transition hover:border-brand/40 hover:text-ink"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}