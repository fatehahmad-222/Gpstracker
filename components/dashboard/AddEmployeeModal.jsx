"use client";

import { useState } from "react";
import { Check, Copy, Dices, Loader2, Mail, UserPlus } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";

const CHARSET = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function generatePassword(length = 10) {
  const bytes = new Uint32Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (n) => CHARSET[n % CHARSET.length]).join("");
}

/**
 * Create a sign-in account.
 *
 * `defaults.employee_id` is what makes this usable from the merged employees
 * screen: the monitor creates an HR row first, so the account is created second
 * and linked back to it. Omit it and this behaves as it always has, as a
 * standalone "create a console account" action.
 *
 * The default is an invite email, because the apps sign in with Supabase Auth.
 * A temporary password stays available as the fallback when email is not set up.
 */
export default function AddEmployeeModal({ open, onClose, onCreated, defaults }) {
  const [fullName, setFullName] = useState(defaults?.full_name || "");
  const [email, setEmail] = useState(defaults?.email || "");
  const [phone, setPhone] = useState(defaults?.phone || "");
  const [mode, setMode] = useState("invite");
  const [password, setPassword] = useState(generatePassword);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  const employeeId = defaults?.employee_id || null;

  const finish = () => {
    const data = result;
    setResult(null);
    onClose();
    onCreated?.(data);
  };

  function reset() {
    setFullName("");
    setEmail("");
    setPhone("");
    setPassword(generatePassword());
    setMode("invite");
    setError(null);
    setResult(null);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const res = await fetch("/api/employees", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          full_name: fullName,
          email,
          phone,
          mode,
          ...(mode === "password" ? { password } : {}),
          ...(employeeId ? { employee_id: employeeId } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Unable to create the account.");

      // Anything the admin still has to hand over stays on screen.
      if (data.temporary_password || data.emailed === false) {
        setResult(data);
      } else {
        reset();
        onClose();
        onCreated?.(data);
      }
    } catch (err) {
      setError(err.message ?? "Unable to create the account.");
    } finally {
      setSaving(false);
    }
  }

  if (result) {
    return (
      <Modal open={open} onClose={finish} title="Sign-in account ready">
        <div className="space-y-4 p-5">
          <p className="text-sm text-ink-dim">
            Give these details to {fullName} so they can sign in to the tracker app.
          </p>

          {result.invite_link ? (
            <Secret
              label="One-time invite link"
              value={result.invite_link}
              hint="They choose their own password after opening it."
            />
          ) : null}

          {result.temporary_password ? (
            <Secret
              label="Temporary password"
              value={result.temporary_password}
              hint="They can change it after signing in."
            />
          ) : null}

          {result.email_error ? (
            <div className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2.5 text-sm text-warning">
              The invite email was not sent ({result.email_error}). Share the link above.
            </div>
          ) : null}

          <div className="flex justify-end gap-2 border-t border-line pt-4">
            <Button type="button" onClick={finish}>
              Done
            </Button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal open={open} onClose={onClose} title="Create sign-in account">
      <form onSubmit={handleSubmit} className="space-y-4 p-5">
        <p className="text-sm text-ink-dim">
          {employeeId
            ? "Creates a sign-in account for this employee and links it to their record."
            : "Creates a sign-in account that the employee uses in the tracker app."}
        </p>

        <div className="grid gap-2 sm:grid-cols-2">
          <ModeOption
            active={mode === "invite"}
            onClick={() => setMode("invite")}
            icon={Mail}
            label="Email an invite"
            hint="Recommended"
          />
          <ModeOption
            active={mode === "password"}
            onClick={() => setMode("password")}
            icon={UserPlus}
            label="Temporary password"
            hint="No email needed"
          />
        </div>

        <Field label="Full name">
          <Input
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="e.g. Ali Raza"
            required
            autoComplete="off"
          />
        </Field>

        <Field label="Email">
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="employee@company.com"
            required
            autoComplete="off"
          />
        </Field>

        <Field label="Phone (optional)">
          <Input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="0300-1234567"
            autoComplete="off"
          />
        </Field>

        {mode === "password" ? (
          <Field label="Temporary password">
            <div className="flex gap-2">
              <Input
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={8}
                required
                autoComplete="new-password"
              />
              <Button
                type="button"
                variant="secondary"
                onClick={() => setPassword(generatePassword())}
                aria-label="Generate a password"
              >
                <Dices size={15} />
              </Button>
            </div>
          </Field>
        ) : (
          <p className="rounded-lg border border-line bg-surface-2 px-3 py-2.5 text-xs text-ink-dim">
            The account is created immediately and the invite link is emailed when a mailer is
            configured. Otherwise the link is shown here for you to copy.
          </p>
        )}

        {error && (
          <div className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2.5 text-sm text-danger">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2 border-t border-line pt-4">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? <Loader2 size={16} className="animate-spin" /> : mode === "invite" ? <Mail size={16} /> : <UserPlus size={16} />}
            {saving ? "Creating…" : mode === "invite" ? "Send invite" : "Create account"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function ModeOption({ active, onClick, icon: Icon, label, hint }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-left transition ${
        active ? "border-accent bg-accent/10" : "border-line bg-surface hover:border-accent/40"
      }`}
    >
      <Icon size={15} className="mt-0.5 shrink-0 text-accent" />
      <span>
        <span className="block text-sm font-medium text-ink">{label}</span>
        <span className="block text-xs text-ink-dim">{hint}</span>
      </span>
    </button>
  );
}

function Secret({ label, value, hint }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access can be denied; the value stays selectable below.
    }
  }

  return (
    <div className="rounded-lg border border-line bg-surface-2 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-ink-dim">{label}</p>
        <button
          type="button"
          onClick={copy}
          className="flex items-center gap-1 rounded-pill border border-line bg-surface px-2 py-1 text-xs font-medium text-ink-dim transition hover:text-ink"
        >
          {copied ? <Check size={11} /> : <Copy size={11} />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <p className="mt-1.5 select-all break-all font-mono text-sm text-ink">{value}</p>
      {hint ? <p className="mt-1 text-xs text-ink-dim">{hint}</p> : null}
    </div>
  );
}
