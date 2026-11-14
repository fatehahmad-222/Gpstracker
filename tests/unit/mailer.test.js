import { afterEach, describe, expect, it, vi } from "vitest";

import { mailerConfigured, sendInviteEmail } from "@/lib/server/mailer";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("mailer", () => {
  it("reports itself unconfigured without a Brevo key", async () => {
    vi.stubEnv("BREVO_API_KEY", "");
    vi.stubEnv("MAIL_FROM", "");
    expect(mailerConfigured()).toBe(false);

    const result = await sendInviteEmail({
      to: "ali@example.com",
      name: "Ali",
      inviteLink: "https://example.com/welcome#access_token=1",
    });

    expect(result).toEqual({
      sent: false,
      reason: "not-configured",
      error: "Email delivery is not configured on the server. Missing: BREVO_API_KEY, MAIL_FROM.",
    });
  });

  it("names the one variable that is missing", async () => {
    vi.stubEnv("BREVO_API_KEY", "test-key");
    vi.stubEnv("MAIL_FROM", "");

    const result = await sendInviteEmail({
      to: "ali@example.com",
      inviteLink: "https://example.com/welcome",
    });

    expect(result.error).toBe(
      "Email delivery is not configured on the server. Missing: MAIL_FROM."
    );
  });

  it("posts the invite to Brevo when configured", async () => {
    vi.stubEnv("BREVO_API_KEY", "test-key");
    vi.stubEnv("MAIL_FROM", "Fleet Console <no-reply@example.com>");
    const fetchMock = vi.fn(async () => ({ ok: true, status: 201 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendInviteEmail({
      to: "ali@example.com",
      name: "Ali <Raza>",
      inviteLink: "https://example.com/welcome#access_token=abc",
      companyName: "Acme & Sons",
    });

    expect(result).toEqual({ sent: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.brevo.com/v3/smtp/email");
    expect(init.method).toBe("POST");
    expect(init.headers["api-key"]).toBe("test-key");

    const body = JSON.parse(init.body);
    expect(body.sender).toEqual({ name: "Fleet Console", email: "no-reply@example.com" });
    expect(body.to).toEqual([{ email: "ali@example.com", name: "Ali <Raza>" }]);
    expect(body.htmlContent).toContain("Ali &lt;Raza&gt;");
    expect(body.htmlContent).toContain("Acme &amp; Sons");
    expect(body.htmlContent).toContain("https://example.com/welcome#access_token=abc");
  });

  it("returns the provider error instead of throwing", async () => {
    vi.stubEnv("BREVO_API_KEY", "test-key");
    vi.stubEnv("MAIL_FROM", "no-reply@example.com");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 500, text: async () => "upstream exploded" }))
    );

    const result = await sendInviteEmail({
      to: "ali@example.com",
      inviteLink: "https://example.com/welcome",
    });

    expect(result.sent).toBe(false);
    expect(result.error).toContain("500");
    expect(result.error).toContain("upstream exploded");
  });

  it("surfaces the provider's JSON message without truncating the fix link", async () => {
    vi.stubEnv("BREVO_API_KEY", "test-key");
    vi.stubEnv("MAIL_FROM", "no-reply@example.com");
    const message =
      "We have detected you are using an unrecognised IP address 32.200.99.220. Add it at https://app.brevo.com/security/authorised_ips";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 401,
        text: async () => JSON.stringify({ message, code: "unauthorized" }),
      }))
    );

    const result = await sendInviteEmail({
      to: "ali@example.com",
      inviteLink: "https://example.com/welcome",
    });

    expect(result.error).toContain("401");
    expect(result.error).toContain("unrecognised IP address 32.200.99.220");
    expect(result.error).toContain("https://app.brevo.com/security/authorised_ips");
  });

  it("returns a network error instead of throwing", async () => {
    vi.stubEnv("BREVO_API_KEY", "test-key");
    vi.stubEnv("MAIL_FROM", "no-reply@example.com");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      })
    );

    const result = await sendInviteEmail({
      to: "ali@example.com",
      inviteLink: "https://example.com/welcome",
    });

    expect(result).toEqual({ sent: false, error: "network down" });
  });
});
