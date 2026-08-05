"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import Link from "next/link";
import { UserPlus, Loader2, AlertCircle, MailCheck } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { getHomePath } from "@/lib/authHelpers";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";

export default function SignupPage() {
  const router = useRouter();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [needsConfirmation, setNeedsConfirmation] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { full_name: fullName } },
      });
      if (error) throw error;

      if (data.session) {
        // Email confirmation disabled — straight in as an employee.
        router.replace(await getHomePath());
        return;
      }
      setNeedsConfirmation(true);
    } catch (err) {
      setError(err.message ?? "Unable to create account.");
    } finally {
      setLoading(false);
    }
  }

  if (needsConfirmation) {
    return (
      <div className="rounded-card border border-line bg-surface p-6 text-center shadow-card sm:p-8">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-accent/12 text-accent">
          <MailCheck size={22} />
        </div>
        <h1 className="font-display text-lg font-semibold text-ink">Check your email</h1>
        <p className="mt-2 text-sm text-ink-dim">
          We sent a confirmation link to <span className="text-ink">{email}</span>.
          Once you confirm, you can sign in. New accounts are created as
          employees — ask your admin to promote you if you need admin access.
        </p>
        <Button variant="secondary" className="mt-5" onClick={() => router.replace("/login")}>
          Back to sign in
        </Button>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-card border border-line bg-surface p-6 shadow-card sm:p-8"
    >
      <h1 className="font-display text-xl font-semibold tracking-tight text-ink">
        Create account
      </h1>
      <p className="mt-1 text-sm text-ink-dim">
        New accounts are employees. Your location will be tracked once you sign in.
      </p>

      <div className="mt-6 space-y-4">
        <Field label="Full name">
          <Input
            required
            autoComplete="name"
            placeholder="e.g. Ali Raza"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
          />
        </Field>
        <Field label="Email">
          <Input
            type="email"
            required
            autoComplete="email"
            placeholder="you@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        <Field label="Password" hint="At least 8 characters.">
          <Input
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
      </div>

      {error && (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2.5 text-sm text-danger">
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <Button type="submit" className="mt-6 w-full" disabled={loading}>
        {loading ? <Loader2 size={16} className="animate-spin" /> : <UserPlus size={16} />}
        {loading ? "Creating account…" : "Create account"}
      </Button>

      <p className="mt-5 text-center text-sm text-ink-dim">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-accent hover:underline">
          Sign in
        </Link>
      </p>
    </form>
  );
}
