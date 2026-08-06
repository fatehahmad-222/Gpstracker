"use client";

import { useState } from "react";
import { Dices, Loader2, UserPlus } from "lucide-react";
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

export default function AddEmployeeModal({ open, onClose, onCreated }) {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState(generatePassword);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const reset = () => {
    setFullName("");
    setEmail("");
    setPhone("");
    setPassword(generatePassword());
    setError(null);
  };

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const res = await fetch("/api/employees", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ full_name: fullName, email, phone, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Unable to create the account.");
      reset();
      onClose();
      onCreated?.(data.user);
    } catch (err) {
      setError(err.message ?? "Unable to create the account.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Add employee">
      <form onSubmit={handleSubmit} className="space-y-4 p-5">
        <p className="text-sm text-ink-dim">
          Creates a sign-in account instantly. Share the temporary password with
          the employee — they can change it after first sign-in.
        </p>

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
            placeholder="+92 300 1234567"
            autoComplete="off"
          />
        </Field>

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
            {saving ? <Loader2 size={16} className="animate-spin" /> : <UserPlus size={16} />}
            {saving ? "Creating…" : "Create account"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
