"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, CheckCircle2, Loader2, LockKeyhole } from "lucide-react";

import { supabase } from "@/lib/supabaseClient";
import { getHomePath } from "@/lib/authHelpers";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";

/**
 * Accept-invite landing page.
 *
 * Supabase's verify endpoint redirects here with the session in the URL (hash
 * tokens for the implicit flow, `?code=` for PKCE). Whichever arrives, establish
 * the session and let the invitee choose a password before entering the app.
 */
export default function WelcomePage() {
  const router = useRouter();
  const [status, setStatus] = useState("checking");
  const [error, setError] = useState(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;

    async function acceptInvite() {
      if (!supabase) {
        setError("Authentication is not configured.");
        setStatus("invalid");
        return;
      }

      try {
        const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
        const search = new URLSearchParams(window.location.search);

        if (search.get("error")) {
          throw new Error(search.get("error_description") || search.get("error"));
        }

        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (!session && hash.get("access_token") && hash.get("refresh_token")) {
          const { error: sessionError } = await supabase.auth.setSession({
            access_token: hash.get("access_token"),
            refresh_token: hash.get("refresh_token"),
          });
          if (sessionError) throw sessionError;
        } else if (!session && search.get("code")) {
          const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(
            search.get("code")
          );
          if (exchangeError) throw exchangeError;
        }

        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (!user) {
          throw new Error(
            "This invite link is invalid or has expired. Ask an admin to send a new one."
          );
        }

        if (active) setStatus("ready");
      } catch (err) {
        if (!active) return;
        setError(err?.message || "This invite link is invalid or has expired.");
        setStatus("invalid");
      }
    }

    acceptInvite();
    return () => {
      active = false;
    };
  }, []);

  async function handleSubmit(event) {
    event.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError("Use at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("The two passwords do not match.");
      return;
    }

    setSaving(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;
      const home = await getHomePath();
      router.replace(home);
    } catch (err) {
      setError(err?.message || "Could not save your password. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-card border border-line bg-surface p-6 shadow-card sm:p-8">
      <div className="flex items-center gap-2.5">
        <span className="grid h-9 w-9 place-items-center rounded-full bg-accent-tint text-accent">
          {status === "ready" ? <LockKeyhole size={17} /> : <CheckCircle2 size={17} />}
        </span>
        <div>
          <h1 className="font-display text-xl font-semibold tracking-tight text-ink">
            {status === "ready" ? "Choose your password" : "Finishing sign-in"}
          </h1>
          <p className="mt-0.5 text-sm text-ink-dim">
            {status === "ready"
              ? "You will use this password in the tracker app from now on."
              : "Checking your invite link."}
          </p>
        </div>
      </div>

      {status === "checking" ? (
        <div role="status" className="mt-6 flex items-center gap-2 text-sm text-ink-dim">
          <Loader2 size={15} className="animate-spin" />
          Verifying the invite…
        </div>
      ) : null}

      {status === "invalid" ? (
        <div className="mt-6 space-y-4">
          <div
            role="alert"
            className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2.5 text-sm text-danger"
          >
            <AlertCircle size={16} className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
          <Link
            href="/login"
            className="inline-block rounded-pill bg-accent px-4 py-2 text-sm font-semibold text-bg transition hover:bg-accent-strong"
          >
            Go to sign in
          </Link>
        </div>
      ) : null}

      {status === "ready" ? (
        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <Field label="New password">
            <Input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="new-password"
              required
              minLength={8}
            />
          </Field>

          <Field label="Confirm password">
            <Input
              type="password"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              autoComplete="new-password"
              required
              minLength={8}
            />
          </Field>

          {error ? (
            <div
              role="alert"
              className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2.5 text-sm text-danger"
            >
              {error}
            </div>
          ) : null}

          <Button type="submit" disabled={saving} className="w-full">
            {saving ? <Loader2 size={16} className="animate-spin" /> : <LockKeyhole size={16} />}
            {saving ? "Saving…" : "Save password and continue"}
          </Button>
        </form>
      ) : null}
    </div>
  );
}
