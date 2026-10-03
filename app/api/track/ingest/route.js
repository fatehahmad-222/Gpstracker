import { dbErrorResponse, ok } from "@/lib/server/api";
import { adminClient, serverError, unauthorized } from "@/lib/server/monitorClient";
import {
  authenticateDevice,
  bearerToken,
  ingestBatch,
  readBoundedJson,
  DEFAULT_DAILY_LIMIT,
} from "@/lib/server/ingest";
import { LIMITS } from "@/lib/monitor/ingest";

export const dynamic = "force-dynamic";

/**
 * POST /api/track/ingest
 *
 * The device write path. Accepts a batch of signal events and position pings
 * from an enrolled handset.
 *
 * Authenticated by bearer token rather than a user session, because the sender is
 * a background service on a phone that may be locked, offline or force-stopped.
 * Everything about the request that identifies *who* is sending it — company,
 * employee — comes from the token, never from the body, so a device cannot report
 * telemetry against somebody else's account even if it wants to.
 *
 * Note the route lives under /api/track rather than /api/monitor: this is the
 * device-facing surface, kept separate from the admin surface that a logged-in
 * user reads.
 */
export async function POST(request) {
  const token = bearerToken(request);
  if (!token) return unauthorized("Missing bearer token");

  // Service role: `device_events` and `locations` are RLS-locked to admin/viewer,
  // because raw device data is the most sensitive material in the product and an
  // employee must never read their own. The authorisation happens here instead.
  const supabase = adminClient();

  let device;
  try {
    device = await authenticateDevice(supabase, token);
  } catch (error) {
    return dbErrorResponse(error, "Could not verify that device");
  }

  // One response for unknown, revoked and expired alike, so this cannot be used
  // to discover which tokens exist.
  if (!device) return unauthorized("Invalid token");

  // Read the body only after the token is verified, so an unauthenticated caller
  // cannot make this endpoint allocate anything at all.
  const parsed = await readBoundedJson(request);
  if (parsed.error === "body_too_large") {
    return Response.json(
      { error: "too_large", message: `Body exceeds ${LIMITS.maxBatchBytes} bytes` },
      { status: 413 }
    );
  }
  if (parsed.error) {
    return Response.json(
      { error: "bad_request", message: "Body must be a JSON object" },
      { status: 400 }
    );
  }

  try {
    const result = await ingestBatch(supabase, {
      device,
      body: parsed.body,
      dailyLimit: DEFAULT_DAILY_LIMIT,
    });

    if (result.error === "quota_exceeded") {
      return Response.json(
        {
          error: "quota_exceeded",
          message: `This device has used its ${result.limit} requests for today`,
        },
        { status: 429 }
      );
    }

    return ok({
      accepted: { events: result.events, pings: result.pings },
      rejected: result.rejected || [],
      message: result.message || "ok",
      limits: { maxEvents: LIMITS.maxEvents, maxPings: LIMITS.maxPings },
    });
  } catch (error) {
    return serverError("Could not store that batch");
  }
}

/** No GET: this endpoint has nothing to say to a browser. */
export async function GET() {
  return Response.json({ error: "method_not_allowed" }, { status: 405 });
}