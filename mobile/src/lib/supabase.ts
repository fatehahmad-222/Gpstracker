import "react-native-url-polyfill/auto";

import { createClient } from "@supabase/supabase-js";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

import { env } from "./env";

const CHUNK_SIZE = 1800;

function safeKey(key: string, suffix: string) {
  return `${key}.${suffix}`.replace(/[^A-Za-z0-9._-]/g, "_");
}

const chunkedSecureStore = {
  async getItem(key: string) {
    const metaKey = safeKey(key, "meta");
    const meta = await SecureStore.getItemAsync(metaKey);
    if (!meta) return SecureStore.getItemAsync(key);

    const count = Number(meta);
    if (!Number.isInteger(count) || count < 1) return null;

    const parts: string[] = [];
    for (let index = 0; index < count; index += 1) {
      const part = await SecureStore.getItemAsync(safeKey(key, `chunk${index}`));
      if (part == null) return null;
      parts.push(part);
    }
    return parts.join("");
  },

  async setItem(key: string, value: string) {
    const metaKey = safeKey(key, "meta");
    const previous = Number(await SecureStore.getItemAsync(metaKey));

    if (value.length <= CHUNK_SIZE) {
      await SecureStore.setItemAsync(key, value);
      await SecureStore.deleteItemAsync(metaKey);
    } else {
      const count = Math.ceil(value.length / CHUNK_SIZE);
      for (let index = 0; index < count; index += 1) {
        await SecureStore.setItemAsync(
          safeKey(key, `chunk${index}`),
          value.slice(index * CHUNK_SIZE, (index + 1) * CHUNK_SIZE)
        );
      }
      await SecureStore.setItemAsync(metaKey, String(count));
      await SecureStore.deleteItemAsync(key);
    }

    if (Number.isInteger(previous) && previous > 0) {
      const nextCount = value.length > CHUNK_SIZE ? Math.ceil(value.length / CHUNK_SIZE) : 0;
      for (let index = nextCount; index < previous; index += 1) {
        await SecureStore.deleteItemAsync(safeKey(key, `chunk${index}`));
      }
    }
  },

  async removeItem(key: string) {
    const metaKey = safeKey(key, "meta");
    const previous = Number(await SecureStore.getItemAsync(metaKey));
    if (Number.isInteger(previous) && previous > 0) {
      for (let index = 0; index < previous; index += 1) {
        await SecureStore.deleteItemAsync(safeKey(key, `chunk${index}`));
      }
    }
    await Promise.all([
      SecureStore.deleteItemAsync(key),
      SecureStore.deleteItemAsync(metaKey),
    ]);
  },
};

const supabaseUrl = env.supabaseUrl || "https://placeholder.supabase.co";
const supabaseKey = env.supabaseAnonKey || "placeholder-anon-key";

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    storage: Platform.OS === "web" ? undefined : chunkedSecureStore,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: Platform.OS === "web",
  },
  global: {
    headers: { "X-Client-Info": "fleet-console-mobile" },
  },
});
