import { normaliseDeviceInfo } from "@/lib/monitor/ingest";
import { issueDeviceToken, revokeDeviceToken } from "./ingest";

export const ENROLLMENTS_PER_DAY = 10;

function cleanText(value, maxLength = 120) {
  if (value == null) return null;
  const text = String(value).trim();
  return text ? text.slice(0, maxLength) : null;
}

export function normaliseDeviceId(value) {
  const text = cleanText(value, 120);
  if (!text || text.length < 4) return null;
  if (!/^[A-Za-z0-9._:-]+$/.test(text)) return null;
  return text;
}

export async function resolveLinkedEmployee(supabase, { companyId, profileId }) {
  if (!companyId || !profileId) return null;

  const { data, error } = await supabase
    .from("employees")
    .select(
      "id, company_id, profile_id, emp_code, name, phone, photo_url, shift_start, shift_end, designation_id, department_id, geofencing_enabled, tracking_consent, consent_at, status, deleted_at"
    )
    .eq("company_id", companyId)
    .eq("profile_id", profileId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) throw error;
  if (!data || data.status !== "active") return null;
  return data;
}

function activeDevices(rows) {
  const now = new Date();
  return rows.filter(
    (row) => !row.revoked_at && (!row.expires_at || new Date(row.expires_at) > now)
  );
}

export async function buildBootstrap({
  admin,
  companyId,
  profileId,
  role,
  settings,
  timezone,
}) {
  const employee = await resolveLinkedEmployee(admin, { companyId, profileId });

  let devices = [];
  let pushTokenCount = 0;

  if (employee) {
    const { data, error } = await admin
      .from("device_tokens")
      .select(
        "id, device_id, label, created_at, last_used_at, revoked_at, expires_at, reenroll_allowed"
      )
      .eq("company_id", companyId)
      .eq("employee_id", employee.id)
      .order("created_at", { ascending: false });

    if (error) throw error;
    devices = data || [];

    const { count } = await admin
      .from("push_tokens")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .eq("profile_id", profileId)
      .is("disabled_at", null);

    pushTokenCount = count || 0;
  }

  const active = activeDevices(devices);
  const latest = devices[0] || null;
  const latestRevoked = latest?.revoked_at ? latest : null;

  return {
    server_time: new Date().toISOString(),
    role,
    company: {
      id: companyId,
      timezone: timezone || "Asia/Karachi",
    },
    employee: employee
      ? {
          id: employee.id,
          emp_code: employee.emp_code,
          name: employee.name,
          phone: employee.phone,
          photo_url: employee.photo_url,
          shift_start: employee.shift_start,
          shift_end: employee.shift_end,
          department_id: employee.department_id,
          designation_id: employee.designation_id,
        }
      : null,
    enrollment: {
      required: Boolean(employee && active.length === 0),
      devices: active.map((device) => ({
        id: device.id,
        device_id: device.device_id,
        label: device.label,
        created_at: device.created_at,
        last_used_at: device.last_used_at,
      })),
      revoked_device: latestRevoked
        ? {
            id: latestRevoked.id,
            device_id: latestRevoked.device_id,
            revoked_at: latestRevoked.revoked_at,
            can_reenroll: Boolean(latestRevoked.reenroll_allowed),
          }
        : null,
    },
    tracking: {
      mode: cleanText(settings?.tracking_mode, 20) || "shift",
      interval_ms: Number(settings?.location_interval_ms) || 60000,
      distance_m: Number(settings?.location_distance_m) || 50,
      geofencing_enabled: employee?.geofencing_enabled ?? true,
      consent: Boolean(employee?.tracking_consent),
      consent_at: employee?.consent_at || null,
    },
    push: {
      registered: pushTokenCount > 0,
      token_count: pushTokenCount,
    },
    app: {
      min_version: cleanText(settings?.min_app_version, 20) || "1.0.0",
      latest_version: cleanText(settings?.latest_app_version, 20) || null,
      update_url: cleanText(settings?.app_update_url, 500) || null,
    },
    features: {
      tasks: true,
      attendance: true,
      leaves: true,
      push: true,
      device_signals: true,
    },
  };
}

export async function recordTrackingConsent({ admin, companyId, employee, consent }) {
  if (!employee) return { error: "employee_unavailable" };

  const now = new Date().toISOString();
  const { data, error } = await admin
    .from("employees")
    .update({
      tracking_consent: consent,
      consent_at: consent ? now : null,
      updated_at: now,
    })
    .eq("company_id", companyId)
    .eq("id", employee.id)
    .select("tracking_consent, consent_at")
    .maybeSingle();

  if (error) throw error;

  let revokedDevices = 0;

  if (!consent) {
    const { data: revoked, error: revokeError } = await admin
      .from("device_tokens")
      .update({ revoked_at: now, reenroll_allowed: false })
      .eq("company_id", companyId)
      .eq("employee_id", employee.id)
      .is("revoked_at", null)
      .select("id");

    if (revokeError) throw revokeError;
    revokedDevices = revoked?.length || 0;

    await admin
      .from("push_tokens")
      .update({ disabled_at: now, updated_at: now })
      .eq("company_id", companyId)
      .eq("employee_id", employee.id)
      .is("disabled_at", null);
  }

  return {
    tracking_consent: data?.tracking_consent ?? consent,
    consent_at: data?.consent_at ?? null,
    revoked_devices: revokedDevices,
  };
}

export async function enrollDevice({
  admin,
  userClient,
  companyId,
  employee,
  body,
  enrollmentsPerDay = ENROLLMENTS_PER_DAY,
}) {
  if (!employee) return { error: "employee_unavailable" };

  const deviceId = normaliseDeviceId(body?.device_id);
  if (!deviceId) return { error: "missing_device_id" };

  const info = normaliseDeviceInfo(body?.device ?? body);
  const label =
    cleanText(body?.label, 120) ||
    cleanText([info.manufacturer, info.model].filter(Boolean).join(" "), 120);

  const { data: allowed, error: quotaError } = await userClient.rpc("consume_api_quota", {
    p_kind: "device_enroll",
    p_limit: enrollmentsPerDay,
    p_period: "day",
    p_company_id: companyId,
  });

  if (quotaError) throw quotaError;
  if (allowed === false) return { error: "rate_limited" };

  const { data: existing, error: existingError } = await admin
    .from("device_tokens")
    .select("id, revoked_at, expires_at, reenroll_allowed")
    .eq("company_id", companyId)
    .eq("employee_id", employee.id)
    .eq("device_id", deviceId)
    .maybeSingle();

  if (existingError) throw existingError;
  if (existing?.revoked_at && !existing.reenroll_allowed) {
    return { error: "reenroll_not_allowed" };
  }

  const issued = await issueDeviceToken(admin, {
    companyId,
    employeeId: employee.id,
    deviceId,
    label,
  });

  if (issued.error) return issued;

  const now = new Date().toISOString();
  const profile = {
    company_id: companyId,
    employee_id: employee.id,
    device_id: deviceId,
    last_login_at: now,
    updated_at: now,
  };

  for (const [key, value] of Object.entries(info)) {
    if (value != null) profile[key] = value;
  }

  const { error: profileError } = await admin
    .from("device_profiles")
    .upsert(profile, { onConflict: "employee_id,device_id" });

  if (profileError) throw profileError;

  return {
    token: issued.token,
    record: issued.record,
    employee: { id: employee.id, emp_code: employee.emp_code, name: employee.name },
  };
}

export async function unenrollDevice({ admin, companyId, employee, body }) {
  if (!employee) return { error: "employee_unavailable" };

  const deviceId = normaliseDeviceId(body?.device_id);
  if (!deviceId) return { error: "missing_device_id" };

  const { data: existing, error: findError } = await admin
    .from("device_tokens")
    .select("id")
    .eq("company_id", companyId)
    .eq("employee_id", employee.id)
    .eq("device_id", deviceId)
    .is("revoked_at", null)
    .maybeSingle();

  if (findError) throw findError;
  if (!existing) return { revoked: false, device_id: deviceId };

  const token = await revokeDeviceToken(admin, { companyId, id: existing.id });
  const now = new Date().toISOString();

  await admin
    .from("push_tokens")
    .update({ disabled_at: now, updated_at: now })
    .eq("company_id", companyId)
    .eq("employee_id", employee.id)
    .eq("device_id", deviceId)
    .is("disabled_at", null);

  return { revoked: Boolean(token), device_id: deviceId };
}

export async function registerPushToken({
  admin,
  companyId,
  profileId,
  employee,
  body,
}) {
  const token = cleanText(body?.token, 512);
  if (!token || token.length < 20) return { error: "invalid_push_token" };

  const platform = body?.platform === "ios" ? "ios" : "android";
  const deviceId = normaliseDeviceId(body?.device_id);
  const now = new Date().toISOString();

  const { data, error } = await admin
    .from("push_tokens")
    .upsert(
      {
        company_id: companyId,
        profile_id: profileId,
        employee_id: employee?.id ?? null,
        device_id: deviceId,
        token,
        platform,
        updated_at: now,
        last_used_at: now,
        disabled_at: null,
      },
      { onConflict: "token" }
    )
    .select("id, token, platform")
    .maybeSingle();

  if (error) throw error;
  return { record: data };
}

export async function unregisterPushToken({ admin, profileId, body }) {
  const token = cleanText(body?.token, 512);
  if (!token) return { error: "invalid_push_token" };

  const now = new Date().toISOString();
  const { data, error } = await admin
    .from("push_tokens")
    .update({ disabled_at: now, updated_at: now })
    .eq("profile_id", profileId)
    .eq("token", token)
    .is("disabled_at", null)
    .select("id")
    .maybeSingle();

  if (error) throw error;
  return { removed: Boolean(data) };
}
