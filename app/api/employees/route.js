import { NextResponse } from "next/server";
import { AUTH_KIND, resolveAuth } from "@/lib/authGuard";
import { createAdminClient } from "@/lib/supabaseAdmin";
import { DEFAULT_COMPANY_ID } from "@/lib/server/monitorClient";
import { generateAppPassword } from "@/lib/monitor/password";
import { sendInviteEmail } from "@/lib/server/mailer";

export const dynamic = "force-dynamic";

/**
 * POST /api/employees — admin creates a sign-in account.
 *
 * Two modes:
 *  - `invite` (default): generate a one-time Supabase invite link and, when a
 *    mailer is configured, email it. Without a mailer the link is returned for
 *    the admin to share, so the flow never depends on paid infrastructure.
 *  - `password`: create the account with a temporary password (generated here
 *    when the body does not carry one) and return it once.
 *
 * `employee_id` links the account back to an HR row. The profile row is created
 * automatically by the on_auth_user_created trigger.
 */
export async function POST(request) {
  const auth = await resolveAuth();

  if (auth.kind === AUTH_KIND.ANON) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  // Deactivated or profile-less: authenticated, but not allowed to act.
  if (auth.kind !== AUTH_KIND.OK) {
    return NextResponse.json({ error: "Admins only." }, { status: 403 });
  }

  if (auth.profile.role !== "admin") {
    return NextResponse.json({ error: "Admins only." }, { status: 403 });
  }

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json(
      { error: "SUPABASE_SERVICE_ROLE_KEY is not configured on the server." },
      { status: 500 }
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const mode = body.mode === "password" ? "password" : "invite";
  const email = String(body.email ?? "").trim().toLowerCase();
  const fullName = String(body.full_name ?? "").trim();
  const phone = String(body.phone ?? "").trim();
  const requestedPassword = String(body.password ?? "");

  // Optional link to an existing HR record. The console and the monitor keep
  // two different employee identities (`profiles.id` vs `employees.id`), so an
  // account is linked back through `employees.profile_id`.
  const employeeId = String(body.employee_id ?? "").trim() || null;

  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  }
  if (!fullName) {
    return NextResponse.json({ error: "Enter the employee's full name." }, { status: 400 });
  }
  if (mode === "password" && requestedPassword && requestedPassword.length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters." }, { status: 400 });
  }

  const admin = createAdminClient();
  const companyId = auth.profile.company_id || DEFAULT_COMPANY_ID;

  // Refuse to re-point an HR row that already has an account: two people
  // sharing one row would silently merge their location history and attendance.
  if (employeeId) {
    const { data: target, error: targetError } = await admin
      .from("employees")
      .select("id, name, profile_id")
      .eq("id", employeeId)
      .eq("company_id", companyId)
      .maybeSingle();

    if (targetError) {
      return NextResponse.json(
        { error: "Could not look up that employee record." },
        { status: 400 }
      );
    }
    if (!target) {
      return NextResponse.json(
        { error: "That employee record does not exist in your company." },
        { status: 404 }
      );
    }
    if (target.profile_id) {
      return NextResponse.json(
        { error: "That employee already has a sign-in account." },
        { status: 409 }
      );
    }
  }

  const metadata = { full_name: fullName, phone: phone || null, company_id: companyId };

  let user;
  let inviteLink = null;
  let temporaryPassword = null;
  let recovered = false;
  let emailed = false;
  let emailError = null;

  if (mode === "invite") {
    const base = (process.env.NEXT_PUBLIC_SITE_URL || new URL(request.url).origin).replace(/\/$/, "");
    const requestedRedirect = String(body.redirect_to ?? "").trim();
    // Only same-origin redirects, so an admin cannot turn this into an open redirect.
    const redirectTo = requestedRedirect.startsWith(`${base}/`)
      ? requestedRedirect
      : `${base}/welcome`;

    let generated = await admin.auth.admin.generateLink({
      type: "invite",
      email,
      options: { data: metadata, redirectTo },
    });

    // A person can be invited before their HR row exists, and later an admin
    // links that same address. Reuse the existing identity with a recovery link
    // instead of failing with "already registered".
    if (generated.error) {
      const recoveredLink = await admin.auth.admin.generateLink({
        type: "recovery",
        email,
        options: { data: metadata, redirectTo },
      });
      if (recoveredLink.error) {
        return NextResponse.json(
          { error: generated.error.message || "Unable to create the sign-in account." },
          { status: 400 }
        );
      }
      generated = recoveredLink;
      recovered = true;
    }

    user = generated.data?.user;
    inviteLink = generated.data?.properties?.action_link || null;

    if (!user) {
      return NextResponse.json(
        { error: "Unable to create the sign-in account." },
        { status: 500 }
      );
    }

    // Never hand an existing account from another company a link into this one.
    if (recovered) {
      const { data: profile } = await admin
        .from("profiles")
        .select("company_id")
        .eq("id", user.id)
        .maybeSingle();
      if (profile?.company_id && profile.company_id !== companyId) {
        return NextResponse.json(
          { error: "That email already belongs to an account in another company." },
          { status: 409 }
        );
      }
    }

    if (inviteLink) {
      const mail = await sendInviteEmail({
        to: email,
        name: fullName,
        inviteLink,
        companyName: body.company_name,
      });
      emailed = Boolean(mail.sent);
      emailError = mail.error || null;
    }
  } else {
    temporaryPassword = requestedPassword || generateAppPassword();

    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: temporaryPassword,
      email_confirm: true,
      user_metadata: metadata,
    });

    if (error) {
      return NextResponse.json(
        { error: error.message || "Unable to create the account." },
        { status: 400 }
      );
    }
    user = data.user;
  }

  if (employeeId) {
    const { error: linkError } = await admin
      .from("employees")
      .update({ profile_id: user.id })
      .eq("id", employeeId)
      .eq("company_id", companyId)
      // Belt and braces: only ever fill a blank slot.
      .is("profile_id", null);

    if (linkError) {
      // The account exists but is unlinked. Say so plainly rather than reporting
      // a success the admin would then have to debug by hand.
      return NextResponse.json(
        {
          error:
            "The sign-in account was created but could not be linked to the employee record. Remove the account and try again.",
          user: { id: user.id, email: user.email },
        },
        { status: 500 }
      );
    }
  }

  return NextResponse.json(
    {
      user: { id: user.id, email: user.email },
      employee_id: employeeId,
      mode,
      invite_link: inviteLink,
      emailed,
      email_error: emailError,
      recovered,
      temporary_password: temporaryPassword,
    },
    { status: 201 }
  );
}
