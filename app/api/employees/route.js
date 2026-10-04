import { NextResponse } from "next/server";
import { AUTH_KIND, resolveAuth } from "@/lib/authGuard";
import { createAdminClient } from "@/lib/supabaseAdmin";
import { DEFAULT_COMPANY_ID } from "@/lib/server/monitorClient";

export const dynamic = "force-dynamic";

/**
 * POST /api/employees — admin creates an employee account directly.
 * Resolves the caller through the shared guard (so the role rule can't drift
 * from the layouts), then uses the service-role client to create the auth user.
 * The profiles row is created automatically by the on_auth_user_created trigger.
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

  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  const fullName = String(body.full_name ?? "").trim();
  const phone = String(body.phone ?? "").trim();

  // Optional link to an existing HR record.
  //
  // The console and the monitor keep two different employee identities:
  // `profiles` (keyed by the auth user id) and `employees` (keyed by HR). This
  // endpoint used to create only the first, so an employee added through the
  // monitor got an HR row with a null `profile_id` and could never appear in the
  // console's own views, which join on profiles. Passing `employee_id` closes
  // that gap instead of leaving a half-linked person.
  const employeeId = String(body.employee_id ?? "").trim() || null;

  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters." }, { status: 400 });
  }
  if (!fullName) {
    return NextResponse.json({ error: "Enter the employee's full name." }, { status: 400 });
  }

  const admin = createAdminClient();

  // Scope the link to the caller's own company and refuse to re-point a row that
  // already has an account: two people sharing one HR row would silently merge
  // their location history and attendance.
  let companyId = auth.profile.company_id || DEFAULT_COMPANY_ID;
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

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName, phone: phone || null, company_id: companyId },
  });

  if (error) {
    return NextResponse.json(
      { error: error.message || "Unable to create the account." },
      { status: 400 }
    );
  }

  // `on_auth_user_created` has already made the profiles row at this point, so the
  // auth user id is the profile id.
  if (employeeId) {
    const { error: linkError } = await admin
      .from("employees")
      .update({ profile_id: data.user.id })
      .eq("id", employeeId)
      .eq("company_id", companyId)
      // Belt and braces: only ever fill a blank slot.
      .is("profile_id", null);

    if (linkError) {
      // The account exists but is unlinked. Say so plainly rather than reporting a
      // success the admin would then have to debug by hand.
      return NextResponse.json(
        {
          error:
            "The sign-in account was created but could not be linked to the employee record. Remove the account and try again.",
          user: data.user,
        },
        { status: 500 }
      );
    }
  }

  return NextResponse.json({ user: data.user, employee_id: employeeId }, { status: 201 });
}
