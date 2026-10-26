import { describe, it, expect, vi } from "vitest";

import { bearerFromHeader } from "@/lib/server/bearer";
import { normaliseDeviceInfo } from "@/lib/monitor/ingest";
import {
  ENROLLMENTS_PER_DAY,
  buildBootstrap,
  normaliseDeviceId,
  recordTrackingConsent,
  registerPushToken,
  unregisterPushToken,
} from "@/lib/server/mobileApp";
import {
  PUSH_MAX_ATTEMPTS,
  buildExpoMessage,
  chunk,
  dispatchPushOutbox,
  expoTicketError,
  retryDelayMs,
} from "@/lib/server/push";

describe("bearerFromHeader", () => {
  it("extracts a case-insensitive bearer token", () => {
    expect(bearerFromHeader("Bearer abc.def.ghi")).toBe("abc.def.ghi");
    expect(bearerFromHeader("bearer   spaced-token  ")).toBe("spaced-token");
  });

  it("rejects anything that is not a bearer credential", () => {
    expect(bearerFromHeader("Basic dXNlcjpwYXNz")).toBeNull();
    expect(bearerFromHeader("Bearer")).toBeNull();
    expect(bearerFromHeader("Bearer   ")).toBeNull();
    expect(bearerFromHeader(null)).toBeNull();
    expect(bearerFromHeader("")).toBeNull();
  });
});

describe("normaliseDeviceInfo", () => {
  it("accepts snake_case and camelCase aliases", () => {
    expect(
      normaliseDeviceInfo({
        model: "Pixel 8",
        manufacturer: "Google",
        androidVersion: "15",
        appVersion: "1.2.3",
        installId: "install-1",
        simFingerprintHash: "hash",
      })
    ).toEqual({
      model: "Pixel 8",
      manufacturer: "Google",
      android_version: "15",
      app_version: "1.2.3",
      install_id: "install-1",
      sim_fingerprint_hash: "hash",
    });
  });

  it("trims, truncates and drops empty values", () => {
    const info = normaliseDeviceInfo({
      model: "  ",
      manufacturer: "M".repeat(200),
      android_version: 15,
    });

    expect(info.model).toBeNull();
    expect(info.manufacturer).toHaveLength(120);
    expect(info.android_version).toBe("15");
    expect(info.app_version).toBeNull();
  });

  it("ignores non-object payloads", () => {
    expect(normaliseDeviceInfo(null)).toEqual({});
    expect(normaliseDeviceInfo([])).toEqual({});
    expect(normaliseDeviceInfo("Pixel")).toEqual({});
  });
});

describe("normaliseDeviceId", () => {
  it("accepts stable Android ID characters and rejects junk", () => {
    expect(normaliseDeviceId("  abc123-XYZ._:  ")).toBe("abc123-XYZ._:");
    expect(normaliseDeviceId("abc")).toBeNull();
    expect(normaliseDeviceId("bad id with spaces")).toBeNull();
    expect(normaliseDeviceId("<script>")).toBeNull();
    expect(normaliseDeviceId(null)).toBeNull();
  });
});

function bootstrapAdmin({ employee, devices = [], pushCount = 0 }) {
  return {
    from(table) {
      const state = { table, count: false };
      const builder = {
        select(_columns, options) {
          state.count = Boolean(options?.head);
          return builder;
        },
        eq() {
          return builder;
        },
        is() {
          return builder;
        },
        order() {
          return builder;
        },
        maybeSingle() {
          return Promise.resolve({ data: table === "employees" ? employee : null, error: null });
        },
        then(resolve, reject) {
          if (table === "push_tokens" && state.count) {
            return Promise.resolve({ count: pushCount, error: null }).then(resolve, reject);
          }
          if (table === "device_tokens") {
            return Promise.resolve({ data: devices, error: null }).then(resolve, reject);
          }
          return Promise.resolve({ data: null, error: null }).then(resolve, reject);
        },
      };
      return builder;
    },
  };
}

const EMPLOYEE = {
  id: "emp-1",
  company_id: "company-1",
  profile_id: "profile-1",
  emp_code: "EMP-001",
  name: "Ali Raza",
  phone: "0300-1234567",
  photo_url: null,
  shift_start: 540,
  shift_end: 1020,
  department_id: "dept-1",
  designation_id: "desig-1",
  geofencing_enabled: true,
  tracking_consent: true,
  consent_at: "2026-01-01T00:00:00.000Z",
  status: "active",
  deleted_at: null,
};

describe("buildBootstrap", () => {
  it("returns enrollment state, tracking settings and feature flags", async () => {
    const admin = bootstrapAdmin({
      employee: EMPLOYEE,
      devices: [
        {
          id: "device-1",
          device_id: "android-1",
          label: "Pixel 8",
          created_at: "2026-01-01T00:00:00.000Z",
          last_used_at: null,
          revoked_at: null,
          expires_at: null,
          reenroll_allowed: false,
        },
      ],
      pushCount: 1,
    });

    const result = await buildBootstrap({
      admin,
      companyId: "company-1",
      profileId: "profile-1",
      role: "employee",
      settings: {
        tracking_mode: "shift",
        location_interval_ms: "45000",
        min_app_version: "1.1.0",
      },
      timezone: "Asia/Karachi",
    });

    expect(result.employee).toMatchObject({ id: "emp-1", emp_code: "EMP-001" });
    expect(result.employee).not.toHaveProperty("basic_salary");
    expect(result.enrollment.required).toBe(false);
    expect(result.enrollment.devices).toHaveLength(1);
    expect(result.tracking).toEqual({
      mode: "shift",
      interval_ms: 45000,
      distance_m: 50,
      geofencing_enabled: true,
      consent: true,
      consent_at: "2026-01-01T00:00:00.000Z",
    });
    expect(result.push).toEqual({ registered: true, token_count: 1 });
    expect(result.app.min_version).toBe("1.1.0");
    expect(result.features.device_signals).toBe(true);
  });

  it("requires enrollment when no device is active", async () => {
    const admin = bootstrapAdmin({ employee: EMPLOYEE, devices: [] });

    const result = await buildBootstrap({
      admin,
      companyId: "company-1",
      profileId: "profile-1",
      role: "employee",
    });

    expect(result.enrollment.required).toBe(true);
    expect(result.tracking.mode).toBe("shift");
    expect(result.tracking.interval_ms).toBe(60000);
    expect(result.company.timezone).toBe("Asia/Karachi");
  });

  it("does not ask an unlinked admin to enroll a device", async () => {
    const admin = bootstrapAdmin({ employee: null });

    const result = await buildBootstrap({
      admin,
      companyId: "company-1",
      profileId: "profile-admin",
      role: "admin",
    });

    expect(result.employee).toBeNull();
    expect(result.enrollment.required).toBe(false);
  });

  it("surfaces a revoked device and whether re-enrollment is allowed", async () => {
    const admin = bootstrapAdmin({
      employee: EMPLOYEE,
      devices: [
        {
          id: "device-1",
          device_id: "android-1",
          label: "Pixel 8",
          created_at: "2026-01-01T00:00:00.000Z",
          last_used_at: null,
          revoked_at: "2026-02-01T00:00:00.000Z",
          expires_at: null,
          reenroll_allowed: true,
        },
      ],
    });

    const result = await buildBootstrap({
      admin,
      companyId: "company-1",
      profileId: "profile-1",
      role: "employee",
    });

    expect(result.enrollment.required).toBe(true);
    expect(result.enrollment.revoked_device).toMatchObject({
      device_id: "android-1",
      can_reenroll: true,
    });
  });
});

function consentAdmin() {
  const updates = [];
  return {
    updates,
    from(table) {
      const state = { table, payload: null };
      const builder = {
        update(payload) {
          state.payload = payload;
          updates.push({ table, payload });
          return builder;
        },
        eq() {
          return builder;
        },
        is() {
          return builder;
        },
        select() {
          return builder;
        },
        maybeSingle() {
          return Promise.resolve({
            data:
              table === "employees"
                ? { tracking_consent: state.payload?.tracking_consent, consent_at: state.payload?.consent_at }
                : null,
            error: null,
          });
        },
        then(resolve, reject) {
          if (table === "device_tokens") {
            return Promise.resolve({ data: [{ id: "device-1" }, { id: "device-2" }], error: null }).then(
              resolve,
              reject
            );
          }
          return Promise.resolve({ data: null, error: null }).then(resolve, reject);
        },
      };
      return builder;
    },
  };
}

describe("recordTrackingConsent", () => {
  it("stores consent without revoking devices", async () => {
    const admin = consentAdmin();

    const result = await recordTrackingConsent({
      admin,
      companyId: "company-1",
      employee: EMPLOYEE,
      consent: true,
    });

    expect(result.tracking_consent).toBe(true);
    expect(result.revoked_devices).toBe(0);
    expect(admin.updates.map((u) => u.table)).toEqual(["employees"]);
  });

  it("revokes device tokens and disables push when consent is withdrawn", async () => {
    const admin = consentAdmin();

    const result = await recordTrackingConsent({
      admin,
      companyId: "company-1",
      employee: EMPLOYEE,
      consent: false,
    });

    expect(result.tracking_consent).toBe(false);
    expect(result.revoked_devices).toBe(2);
    expect(admin.updates.map((u) => u.table)).toEqual([
      "employees",
      "device_tokens",
      "push_tokens",
    ]);
    expect(admin.updates[1].payload).toMatchObject({ reenroll_allowed: false });
    expect(admin.updates[1].payload.revoked_at).toBeTruthy();
    expect(admin.updates[2].payload.disabled_at).toBeTruthy();
  });
});

function pushTokenAdmin() {
  return {
    from() {
      const builder = {
        upsert() {
          return builder;
        },
        update() {
          return builder;
        },
        eq() {
          return builder;
        },
        is() {
          return builder;
        },
        select() {
          return builder;
        },
        maybeSingle() {
          return Promise.resolve({
            data: { id: "push-1", token: "ExponentPushToken[abc]", platform: "android" },
            error: null,
          });
        },
      };
      return builder;
    },
  };
}

describe("push token registration", () => {
  it("rejects tokens that are too short to be real", async () => {
    const result = await registerPushToken({
      admin: pushTokenAdmin(),
      companyId: "company-1",
      profileId: "profile-1",
      employee: EMPLOYEE,
      body: { token: "short" },
    });

    expect(result.error).toBe("invalid_push_token");
  });

  it("registers a valid token against the signed-in profile", async () => {
    const result = await registerPushToken({
      admin: pushTokenAdmin(),
      companyId: "company-1",
      profileId: "profile-1",
      employee: EMPLOYEE,
      body: {
        token: "ExponentPushToken[abcdefghijklmnopqrstuvwxyz]",
        platform: "android",
        device_id: "android-1",
      },
    });

    expect(result.record).toMatchObject({ id: "push-1", platform: "android" });
  });

  it("unregisters only the caller's own token", async () => {
    const admin = {
      from() {
        const builder = {
          update() {
            return builder;
          },
          eq() {
            return builder;
          },
          is() {
            return builder;
          },
          select() {
            return builder;
          },
          maybeSingle() {
            return Promise.resolve({ data: { id: "push-1" }, error: null });
          },
        };
        return builder;
      },
    };

    await expect(
      unregisterPushToken({ admin, profileId: "profile-1", body: { token: "ExponentPushToken[abc]" } })
    ).resolves.toEqual({ removed: true });
    await expect(unregisterPushToken({ admin, profileId: "profile-1", body: {} })).resolves.toEqual({
      error: "invalid_push_token",
    });
  });
});

describe("push helpers", () => {
  it("splits deliveries into Expo-sized batches", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 2)).toEqual([]);
  });

  it("backs off exponentially up to an hour", () => {
    expect(retryDelayMs(1)).toBe(30000);
    expect(retryDelayMs(2)).toBe(60000);
    expect(retryDelayMs(3)).toBe(120000);
    expect(retryDelayMs(20)).toBe(3600000);
    expect(retryDelayMs(null)).toBe(30000);
  });

  it("builds a high-priority Android message", () => {
    expect(
      buildExpoMessage(
        { title: "New task", body: "Visit Site A", data: { task_id: "t1" } },
        { token: "ExponentPushToken[x]" }
      )
    ).toEqual({
      to: "ExponentPushToken[x]",
      title: "New task",
      body: "Visit Site A",
      data: { task_id: "t1" },
      sound: "default",
      priority: "high",
      channelId: "default",
    });
  });

  it("reads Expo ticket errors", () => {
    expect(expoTicketError({ status: "ok", id: "ticket" })).toBeNull();
    expect(expoTicketError({ status: "error", details: { error: "DeviceNotRegistered" } })).toBe(
      "DeviceNotRegistered"
    );
    expect(expoTicketError({ status: "error", message: "bad request" })).toBe("bad request");
    expect(expoTicketError(null)).toBe("missing_ticket");
  });
});

function dispatcherAdmin({ rows, tokens, onUpdate, onDisable }) {
  return {
    rpc(name) {
      expect(name).toBe("claim_push_outbox");
      return Promise.resolve({ data: rows, error: null });
    },
    from(table) {
      if (table === "push_tokens") {
        const state = { reading: false };
        const builder = {
          select() {
            state.reading = true;
            return builder;
          },
          in() {
            return builder;
          },
          update(payload) {
            onDisable?.(payload);
            return builder;
          },
          eq() {
            return builder;
          },
          is() {
            return builder;
          },
          then(resolve, reject) {
            const result = state.reading ? { data: tokens, error: null } : { error: null };
            return Promise.resolve(result).then(resolve, reject);
          },
        };
        return builder;
      }

      const builder = {
        update(payload) {
          onUpdate?.(payload);
          return builder;
        },
        eq() {
          return Promise.resolve({ error: null });
        },
      };
      return builder;
    },
  };
}

describe("dispatchPushOutbox", () => {
  it("sends one Expo request per chunk and finalizes every outbox row", async () => {
    const rows = [
      {
        id: "out-1",
        recipient_profile_id: "profile-1",
        title: "New task",
        body: "Visit Site A",
        data: { type: "task_assigned" },
        attempts: 1,
      },
      {
        id: "out-2",
        recipient_profile_id: "profile-missing",
        title: "No device",
        body: "Skipped",
        data: {},
        attempts: 1,
      },
    ];
    const tokens = [
      { id: "token-1", profile_id: "profile-1", token: "ExponentPushToken[good]" },
      { id: "token-2", profile_id: "profile-1", token: "ExponentPushToken[stale]" },
    ];
    const updates = [];
    const disabled = [];
    const fetchImpl = vi.fn(async (_url, init) => {
      expect(JSON.parse(init.body)).toHaveLength(2);
      return {
        ok: true,
        json: async () => ({
          data: [{ status: "ok" }, { status: "error", details: { error: "DeviceNotRegistered" } }],
        }),
      };
    });

    const result = await dispatchPushOutbox({
      supabase: dispatcherAdmin({
        rows,
        tokens,
        onUpdate: (payload) => updates.push(payload),
        onDisable: (payload) => disabled.push(payload),
      }),
      fetchImpl,
      accessToken: "expo-access-token",
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(disabled).toHaveLength(1);
    expect(updates.filter((u) => u.status === "sent")).toHaveLength(1);
    expect(updates.filter((u) => u.status === "skipped")).toHaveLength(1);
    expect(result).toMatchObject({
      claimed: 2,
      sent: 1,
      skipped: 1,
      failed: 0,
      retrying: 0,
      disabled: 1,
    });
  });

  it("returns a zeroed result when nothing is claimable", async () => {
    const result = await dispatchPushOutbox({
      supabase: dispatcherAdmin({ rows: [], tokens: [] }),
    });

    expect(result).toEqual({ claimed: 0, sent: 0, skipped: 0, failed: 0, retrying: 0, disabled: 0 });
  });

  it("retries a row with exponential backoff after a network failure", async () => {
    const updates = [];
    const rows = [
      {
        id: "out-1",
        recipient_profile_id: "profile-1",
        title: "Task",
        body: "Body",
        data: {},
        attempts: 2,
      },
    ];

    const result = await dispatchPushOutbox({
      supabase: dispatcherAdmin({
        rows,
        tokens: [{ id: "token-1", profile_id: "profile-1", token: "ExponentPushToken[x]" }],
        onUpdate: (payload) => updates.push(payload),
      }),
      fetchImpl: async () => ({ ok: false, status: 503 }),
    });

    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({ status: "pending", locked_at: null });
    expect(updates[0].next_attempt_at).toBeTruthy();
    expect(result.retrying).toBe(1);
  });

  it("marks a row failed once it has exhausted its attempts", async () => {
    const updates = [];
    const rows = [
      {
        id: "out-1",
        recipient_profile_id: "profile-1",
        title: "Task",
        body: "Body",
        data: {},
        attempts: PUSH_MAX_ATTEMPTS,
      },
    ];

    const result = await dispatchPushOutbox({
      supabase: dispatcherAdmin({
        rows,
        tokens: [{ id: "token-1", profile_id: "profile-1", token: "ExponentPushToken[x]" }],
        onUpdate: (payload) => updates.push(payload),
      }),
      fetchImpl: async () => ({ ok: false, status: 500 }),
    });

    expect(updates[0]).toMatchObject({ status: "failed", last_error: "Expo push HTTP 500" });
    expect(result.failed).toBe(1);
  });
});

describe("enrollment quota default", () => {
  it("keeps the per-day enrollment cap conservative", () => {
    expect(ENROLLMENTS_PER_DAY).toBe(10);
  });
});
