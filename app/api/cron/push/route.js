import { timingSafeEqual } from "node:crypto";

import { bearerFromHeader } from "@/lib/server/bearer";
import { adminClient, serverError } from "@/lib/server/monitorClient";
import { dispatchPushOutbox } from "@/lib/server/push";

export const dynamic = "force-dynamic";

function secretsMatch(left, right) {
  if (!left || !right) return false;
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && timingSafeEqual(a, b);
}

function isAuthorized(request) {
  const expected = process.env.PUSH_DISPATCH_SECRET || process.env.CRON_SECRET;
  if (!expected) return { configured: false, allowed: false };

  const provided =
    bearerFromHeader(request.headers.get("authorization")) ||
    request.headers.get("x-push-secret");

  return { configured: true, allowed: secretsMatch(provided, expected) };
}

async function dispatch(request) {
  const auth = isAuthorized(request);

  if (!auth.configured) {
    return Response.json(
      { error: "PUSH_DISPATCH_SECRET or CRON_SECRET is not configured" },
      { status: 503 }
    );
  }

  if (!auth.allowed) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let admin;
  try {
    admin = adminClient();
  } catch {
    return serverError("Push dispatch is not configured on this server");
  }

  try {
    const result = await dispatchPushOutbox({ supabase: admin });
    return Response.json({ ok: true, ...result });
  } catch (error) {
    console.error("[push] dispatch failed", error?.message);
    return serverError("Could not dispatch push notifications");
  }
}

export async function GET(request) {
  return dispatch(request);
}

export async function POST(request) {
  return dispatch(request);
}
