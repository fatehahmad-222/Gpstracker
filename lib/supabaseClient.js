import { createBrowserClient } from "@supabase/ssr";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// Placeholders keep the client constructible during `next build` (SSR/prerender)
// and let the app boot before env vars are configured. Requests only ever fire
// once real keys exist.
const resolvedUrl = supabaseUrl || "https://placeholder.supabase.co";
const resolvedKey = supabaseAnonKey || "placeholder-anon-key";

if ((!supabaseUrl || !supabaseAnonKey) && typeof window !== "undefined") {
  console.warn(
    "Supabase env vars are missing. Copy .env.local.example to .env.local and fill in your project keys."
  );
}

// The browser client must only be constructed in the browser — `next build`
// evaluates client-module scope on the server for prerendering, and
// createBrowserClient references `window`.
export const supabase =
  typeof window !== "undefined"
    ? createBrowserClient(resolvedUrl, resolvedKey)
    : null;
