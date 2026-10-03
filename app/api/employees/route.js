import { NextResponse } from "next/server";
import { AUTH_KIND, resolveAuth } from "@/lib/authGuard";
import { createAdminClient } from "@/lib/supabaseAdmin";

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
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName, phone: phone || null },
  });

  if (error) {
    return NextResponse.json(
      { error: error.message || "Unable to create the account." },
      { status: 400 }
    );
  }

  return NextResponse.json({ user: data.user }, { status: 201 });
}
