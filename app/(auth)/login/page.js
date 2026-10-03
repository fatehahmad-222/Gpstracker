"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import Link from "next/link";
import { LogIn, Loader2, AlertCircle, Info } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { getHomePath } from "@/lib/authHelpers";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";

const REASON_COPY = {
  deactivated:
    "That account has been deactivated by an administrator. Contact them if you think this is a mistake.",
  "no-profile":
    "We couldn’t find a profile for that account. Ask an administrator to check it.",
};

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const notice = REASON_COPY[searchParams.get("reason")];

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      const next = searchParams.get("next");
      router.replace(next && next.startsWith("/") ? next : (await getHomePath()));
    } catch (err) {
      setError(err.message ?? "Unable to sign in.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-card border border-line bg-surface p-6 shadow-card sm:p-8"
    >
      <h1 className="font-display text-xl font-semibold tracking-tight text-ink">
        Sign in
      </h1>
      <p className="mt-1 text-sm text-ink-dim">
        Admins see the live dashboard; employees get their tasks.
      </p>

      <div className="mt-6 space-y-4">
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
        <Field label="Password">
          <Input
            type="password"
            required
            autoComplete="current-password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
      </div>

      {notice && (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-line bg-surface-2 px-3 py-2.5 text-sm text-ink-dim">
          <Info size={16} className="mt-0.5 shrink-0" />
          <span>{notice}</span>
        </div>
      )}

      {error && (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2.5 text-sm text-danger">
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <Button type="submit" className="mt-6 w-full" disabled={loading}>
        {loading ? <Loader2 size={16} className="animate-spin" /> : <LogIn size={16} />}
        {loading ? "Signing in…" : "Sign in"}
      </Button>

      <p className="mt-5 text-center text-sm text-ink-dim">
        No account?{" "}
        <Link href="/signup" className="font-medium text-accent hover:underline">
          Create an account
        </Link>
      </p>
    </form>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
