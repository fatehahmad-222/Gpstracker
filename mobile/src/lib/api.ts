import { env } from "./env";
import { supabase } from "./supabase";

export class ApiError extends Error {
  status: number;
  fields?: Record<string, string> | null;
  code?: string | null;

  constructor(
    message: string,
    status: number,
    options?: { fields?: Record<string, string> | null; code?: string | null }
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.fields = options?.fields;
    this.code = options?.code;
  }
}

type RequestOptions = {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  signal?: AbortSignal;
  auth?: boolean;
  timeoutMs?: number;
};

async function readBody(response: Response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { error: text };
  }
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  if (!env.apiUrl) {
    throw new ApiError("EXPO_PUBLIC_API_URL is not configured", 0, { code: "not_configured" });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 25_000);
  const signal = options.signal ?? controller.signal;

  const headers: Record<string, string> = { Accept: "application/json" };

  if (options.auth !== false) {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.access_token) {
      clearTimeout(timeout);
      throw new ApiError("Your session has expired. Sign in again.", 401, { code: "unauthorized" });
    }
    headers.Authorization = `Bearer ${session.access_token}`;
  }

  if (options.body !== undefined) headers["Content-Type"] = "application/json";

  try {
    const response = await fetch(`${env.apiUrl}${path}`, {
      method: options.method ?? "GET",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal,
    });

    const payload = await readBody(response);

    if (!response.ok) {
      const message =
        (payload && (payload.message || payload.error)) ||
        `Request failed with status ${response.status}`;
      throw new ApiError(String(message), response.status, {
        fields: payload?.fields ?? null,
        code: payload?.error ?? null,
      });
    }

    return payload as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if ((error as Error)?.name === "AbortError") {
      throw new ApiError("The server took too long to respond. Try again.", 0, {
        code: "timeout",
      });
    }
    throw new ApiError("You appear to be offline. Check your connection.", 0, {
      code: "network",
    });
  } finally {
    clearTimeout(timeout);
  }
}

export function errorMessage(error: unknown) {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return "Something went wrong";
}
