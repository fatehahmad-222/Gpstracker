export const EXPO_PUSH_ENDPOINT = "https://exp.host/--/api/v2/push/send";
export const PUSH_MAX_ATTEMPTS = 5;

export function chunk(items, size = 100) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

export function retryDelayMs(attempts) {
  const safeAttempts = Math.max(1, Number(attempts) || 1);
  return Math.min(60 * 60 * 1000, 30_000 * 2 ** (safeAttempts - 1));
}

export function buildExpoMessage(outboxRow, pushToken) {
  return {
    to: pushToken.token,
    title: outboxRow.title,
    body: outboxRow.body,
    data: outboxRow.data || {},
    sound: "default",
    priority: "high",
    channelId: "default",
  };
}

export function expoTicketError(ticket) {
  if (!ticket) return "missing_ticket";
  if (ticket.status === "ok") return null;
  return ticket.details?.error || ticket.message || "push_failed";
}

async function finalizeRow(supabase, row, outcome) {
  const now = new Date().toISOString();
  const update = { locked_at: null };

  if (outcome.status === "sent") {
    update.status = "sent";
    update.sent_at = now;
    update.last_error = null;
  } else if (outcome.status === "skipped") {
    update.status = "skipped";
    update.sent_at = now;
    update.last_error = null;
  } else if (row.attempts >= PUSH_MAX_ATTEMPTS) {
    update.status = "failed";
    update.last_error = outcome.error || "push_failed";
  } else {
    update.status = "pending";
    update.next_attempt_at = new Date(
      Date.now() + retryDelayMs(row.attempts)
    ).toISOString();
    update.last_error = outcome.error || "push_failed";
  }

  const { error } = await supabase.from("push_outbox").update(update).eq("id", row.id);
  if (error) throw error;
}

async function disableToken(supabase, tokenId) {
  const { error } = await supabase
    .from("push_tokens")
    .update({ disabled_at: new Date().toISOString() })
    .eq("id", tokenId)
    .is("disabled_at", null);

  if (error) throw error;
}

export async function dispatchPushOutbox({
  supabase,
  limit = 100,
  fetchImpl = fetch,
  accessToken = process.env.EXPO_ACCESS_TOKEN,
} = {}) {
  const { data: claimed, error } = await supabase.rpc("claim_push_outbox", {
    p_limit: limit,
  });

  if (error) throw error;

  const rows = claimed || [];
  if (!rows.length) {
    return { claimed: 0, sent: 0, skipped: 0, failed: 0, retrying: 0, disabled: 0 };
  }

  const profileIds = [...new Set(rows.map((row) => row.recipient_profile_id))];
  const { data: tokenRows, error: tokenError } = await supabase
    .from("push_tokens")
    .select("id, profile_id, token")
    .in("profile_id", profileIds)
    .is("disabled_at", null);

  if (tokenError) throw tokenError;

  const tokensByProfile = new Map();
  for (const token of tokenRows || []) {
    const list = tokensByProfile.get(token.profile_id) || [];
    list.push(token);
    tokensByProfile.set(token.profile_id, list);
  }

  const outcomes = new Map();
  const deliveries = [];
  let skipped = 0;

  for (const row of rows) {
    const profileTokens = tokensByProfile.get(row.recipient_profile_id) || [];
    if (!profileTokens.length) {
      outcomes.set(row.id, { status: "skipped", error: null });
      skipped += 1;
      continue;
    }

    for (const token of profileTokens) {
      deliveries.push({ row, token });
    }
  }

  let disabled = 0;

  for (const batch of chunk(deliveries, 100)) {
    const payload = batch.map(({ row, token }) => buildExpoMessage(row, token));
    let tickets = [];

    try {
      const response = await fetchImpl(EXPO_PUSH_ENDPOINT, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(`Expo push HTTP ${response.status}`);
      }

      const json = await response.json();
      tickets = Array.isArray(json?.data) ? json.data : [];
    } catch (error) {
      for (const { row } of batch) {
        outcomes.set(row.id, {
          status: "failed",
          error: error?.message || "push_request_failed",
        });
      }
      continue;
    }

    for (const [index, delivery] of batch.entries()) {
      const ticketError = expoTicketError(tickets[index]);
      const previous = outcomes.get(delivery.row.id);

      if (!ticketError) {
        outcomes.set(delivery.row.id, { status: "sent", error: null });
        continue;
      }

      if (!previous || previous.status !== "sent") {
        outcomes.set(delivery.row.id, {
          status: "failed",
          error: ticketError,
        });
      }

      if (ticketError === "DeviceNotRegistered") {
        try {
          await disableToken(supabase, delivery.token.id);
          disabled += 1;
        } catch (error) {
          console.error("[push] failed to disable token", error?.message);
        }
      }
    }
  }

  const counts = { claimed: rows.length, sent: 0, skipped, failed: 0, retrying: 0, disabled };

  for (const row of rows) {
    const outcome = outcomes.get(row.id) || {
      status: "failed",
      error: "no_push_result",
    };

    try {
      await finalizeRow(supabase, row, outcome);
    } catch (error) {
      console.error("[push] failed to finalize outbox row", error?.message);
    }

    if (outcome.status === "sent") counts.sent += 1;
    else if (outcome.status === "skipped") {
      continue;
    } else if (row.attempts >= PUSH_MAX_ATTEMPTS) counts.failed += 1;
    else counts.retrying += 1;
  }

  return counts;
}
