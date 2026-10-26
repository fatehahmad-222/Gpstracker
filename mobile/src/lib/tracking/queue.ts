import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Network from "expo-network";
import * as SecureStore from "expo-secure-store";

import { STORAGE_KEYS } from "../constants";
import { env } from "../env";
import {
  clearQueue,
  deleteQueued,
  pruneQueue,
  queueSnapshot,
  takePending,
} from "./db";
import type { QueueBatch, QueueSnapshot } from "./db-types";

export class DeviceRevokedError extends Error {
  constructor() {
    super("This device has been signed out by an administrator");
    this.name = "DeviceRevokedError";
  }
}

export type FlushResult = {
  status:
    | "ok"
    | "empty"
    | "offline"
    | "not_enrolled"
    | "revoked"
    | "rate_limited"
    | "error";
  sent: number;
  error?: string;
};

let inFlight: Promise<FlushResult> | null = null;

async function markRevoked() {
  await AsyncStorage.setItem(STORAGE_KEYS.deviceRevoked, "1");
  await AsyncStorage.removeItem(STORAGE_KEYS.trackingActive);
  await SecureStore.deleteItemAsync(STORAGE_KEYS.deviceToken);
}

function ids(batch: QueueBatch) {
  return {
    eventIds: batch.events.map((row) => row.id),
    pingIds: batch.pings.map((row) => row.id),
  };
}

async function sendBatch(batch: QueueBatch): Promise<number> {
  const total = batch.events.length + batch.pings.length;
  if (total === 0) return 0;

  const token = await SecureStore.getItemAsync(STORAGE_KEYS.deviceToken);
  if (!token) throw new Error("device_token_missing");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);

  let response: Response;
  try {
    response = await fetch(`${env.apiUrl}/api/track/ingest`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        events: batch.events.map(({ id: _id, ...event }) => event),
        pings: batch.pings.map(({ id: _id, ...ping }) => ping),
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  if (response.status === 401) {
    await markRevoked();
    throw new DeviceRevokedError();
  }

  if (response.status === 413 && total > 1) {
    const midEvents = Math.ceil(batch.events.length / 2);
    const midPings = Math.ceil(batch.pings.length / 2);
    const first = await sendBatch({
      events: batch.events.slice(0, midEvents),
      pings: batch.pings.slice(0, midPings),
    });
    const second = await sendBatch({
      events: batch.events.slice(midEvents),
      pings: batch.pings.slice(midPings),
    });
    return first + second;
  }

  if (response.status === 429) {
    throw new Error("rate_limited");
  }

  if (!response.ok) {
    throw new Error(`ingest_${response.status}`);
  }

  const { eventIds, pingIds } = ids(batch);
  await deleteQueued(eventIds, pingIds);
  return total;
}

export async function flushQueue(): Promise<FlushResult> {
  if (inFlight) return inFlight;

  inFlight = (async (): Promise<FlushResult> => {
    if (await AsyncStorage.getItem(STORAGE_KEYS.deviceRevoked)) {
      return { status: "revoked", sent: 0 };
    }

    if (!env.apiUrl) {
      return { status: "error", sent: 0, error: "api_not_configured" };
    }

    const token = await SecureStore.getItemAsync(STORAGE_KEYS.deviceToken);
    if (!token) return { status: "not_enrolled", sent: 0 };

    try {
      const network = await Network.getNetworkStateAsync();
      if (network.isConnected === false) return { status: "offline", sent: 0 };

      await pruneQueue();

      let sent = 0;
      for (let round = 0; round < 6; round += 1) {
        const batch = await takePending();
        if (!batch.events.length && !batch.pings.length) break;
        sent += await sendBatch(batch);
      }

      const now = new Date().toISOString();
      await AsyncStorage.setItem(STORAGE_KEYS.trackingLastSync, now);
      return { status: sent > 0 ? "ok" : "empty", sent };
    } catch (error) {
      if (error instanceof DeviceRevokedError) {
        return { status: "revoked", sent: 0, error: error.message };
      }
      const message = (error as Error)?.message || "sync_failed";
      if (message === "rate_limited") {
        return { status: "rate_limited", sent: 0, error: message };
      }
      if (message === "device_token_missing") {
        return { status: "not_enrolled", sent: 0 };
      }
      return { status: "error", sent: 0, error: message };
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

export async function pendingQueue(): Promise<QueueSnapshot> {
  return queueSnapshot();
}

export async function wipeQueue() {
  await clearQueue();
}

export async function lastSyncAt() {
  return AsyncStorage.getItem(STORAGE_KEYS.trackingLastSync);
}

export async function clearRevokedFlag() {
  await AsyncStorage.removeItem(STORAGE_KEYS.deviceRevoked);
}

export async function isDeviceRevoked() {
  return Boolean(await AsyncStorage.getItem(STORAGE_KEYS.deviceRevoked));
}
