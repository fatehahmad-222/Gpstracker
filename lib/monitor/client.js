"use client";

/**
 * Tiny fetch helper for the monitor's client components.
 *
 * Route handlers already normalise errors to `{ error, fields? }`, so this just
 * turns a non-2xx into a thrown object the form can render, and keeps the
 * `credentials`/cache behaviour consistent across every screen.
 */

export class ApiError extends Error {
  constructor(message, { status, fields } = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.fields = fields || null;
  }
}

async function request(url, { method = "GET", body, signal } = {}) {
  let response;
  try {
    response = await fetch(url, {
      method,
      signal,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
    });
  } catch (err) {
    if (err?.name === "AbortError") throw err;
    throw new ApiError("Network error — check your connection and try again", { status: 0 });
  }

  // 204 and empty bodies are legitimate successes.
  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      throw new ApiError("The server sent an unexpected response", { status: response.status });
    }
  }

  if (!response.ok) {
    throw new ApiError(payload?.error || `Request failed (${response.status})`, {
      status: response.status,
      fields: payload?.fields,
    });
  }

  return payload;
}

export const api = {
  get: (url, opts) => request(url, { ...opts, method: "GET" }),
  post: (url, body, opts) => request(url, { ...opts, method: "POST", body }),
  patch: (url, body, opts) => request(url, { ...opts, method: "PATCH", body }),
  delete: (url, opts) => request(url, { ...opts, method: "DELETE" }),
};

/** Build a query string, dropping empty values so URLs stay clean. */
export function qs(params) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined || value === "") continue;
    search.set(key, String(value));
  }
  const str = search.toString();
  return str ? `?${str}` : "";
}