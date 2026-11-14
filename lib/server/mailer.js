/**
 * Best-effort transactional mail for sign-in invites.
 *
 * The project deliberately carries no paid email dependency. When
 * `BREVO_API_KEY` and `MAIL_FROM` are set this sends through Brevo's free HTTP
 * API (300 messages/day, no card). When they are not configured it reports
 * `sent: false` and the caller shows the invite link for the admin to share
 * instead — so the feature still works on a fresh checkout.
 *
 * A mail failure must never fail account creation: the account and the invite
 * link already exist by the time this runs, and the admin can always copy the
 * link. Every error is therefore returned, never thrown.
 */

const BREVO_ENDPOINT = "https://api.brevo.com/v3/smtp/email";

export function mailerConfigured() {
  return Boolean(process.env.BREVO_API_KEY && process.env.MAIL_FROM);
}

/** `MAIL_FROM` accepts either `no-reply@example.com` or `Name <no-reply@example.com>`. */
function parseSender(value) {
  const match = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(String(value || ""));
  if (match) {
    return { name: match[1] || undefined, email: match[2].trim() };
  }
  return { email: String(value || "").trim() };
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export async function sendInviteEmail({ to, name, inviteLink, companyName }) {
  if (!mailerConfigured()) {
    return { sent: false, reason: "not-configured" };
  }

  const sender = parseSender(process.env.MAIL_FROM);
  const safeName = escapeHtml(name || "there");
  const safeCompany = escapeHtml(companyName || "the fleet console");
  const safeLink = escapeHtml(inviteLink);

  const htmlContent = `
    <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;line-height:1.5;color:#111827">
      <p>Hi ${safeName},</p>
      <p>You have been added to <strong>${safeCompany}</strong>. Use the link below to choose a password and sign in to the tracker app.</p>
      <p style="margin:24px 0">
        <a href="${safeLink}" style="display:inline-block;border-radius:9999px;background:#2563eb;color:#ffffff;padding:10px 18px;text-decoration:none;font-weight:600">Set your password</a>
      </p>
      <p style="font-size:12px;color:#6b7280">If the button does not work, copy this link into your browser:<br><a href="${safeLink}">${safeLink}</a></p>
      <p style="font-size:12px;color:#6b7280">This link can only be used once. If it has expired, ask an admin to send a new invite.</p>
    </div>
  `;

  try {
    const response = await fetch(BREVO_ENDPOINT, {
      method: "POST",
      headers: {
        "api-key": process.env.BREVO_API_KEY,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        sender,
        to: [{ email: to, name: name || undefined }],
        subject: `Your sign-in link for ${companyName || "the fleet console"}`,
        htmlContent,
        textContent: `Hi ${name || "there"},\n\nYou have been added to ${companyName || "the fleet console"}. Choose a password and sign in here:\n${inviteLink}\n\nThis link can only be used once. If it has expired, ask an admin to send a new invite.`,
      }),
      signal:
        typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
          ? AbortSignal.timeout(8000)
          : undefined,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      return {
        sent: false,
        error: `Email provider responded ${response.status}${body ? `: ${body.slice(0, 200)}` : ""}`,
      };
    }

    return { sent: true };
  } catch (error) {
    return { sent: false, error: error?.message || "Email could not be sent" };
  }
}
