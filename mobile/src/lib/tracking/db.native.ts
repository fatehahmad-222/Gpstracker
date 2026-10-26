import * as SQLite from "expo-sqlite";

import type { QueueBatch, QueueSnapshot, QueuedEvent, QueuedPing } from "./db-types";

let database: Promise<SQLite.SQLiteDatabase> | null = null;

async function db() {
  if (!database) {
    database = SQLite.openDatabaseAsync("fleet-queue.db").then(async (instance) => {
      await instance.execAsync(`
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS queued_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          client_event_id TEXT NOT NULL UNIQUE,
          type TEXT NOT NULL,
          occurred_at TEXT NOT NULL,
          meta TEXT NOT NULL DEFAULT '{}',
          created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS queued_pings (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          client_event_id TEXT NOT NULL UNIQUE,
          lat REAL NOT NULL,
          lng REAL NOT NULL,
          accuracy REAL,
          speed REAL,
          heading REAL,
          battery_pct INTEGER,
          provider TEXT,
          recorded_at TEXT NOT NULL,
          created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS queued_events_created ON queued_events(created_at);
        CREATE INDEX IF NOT EXISTS queued_pings_created ON queued_pings(created_at);
      `);
      return instance;
    });
  }
  return database;
}

export async function enqueueEvent(
  item: Omit<QueuedEvent, "id">
): Promise<void> {
  const instance = await db();
  await instance.runAsync(
    `INSERT OR IGNORE INTO queued_events
      (client_event_id, type, occurred_at, meta, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    [
      item.client_event_id,
      item.type,
      item.occurred_at,
      JSON.stringify(item.meta ?? {}),
      Date.now(),
    ]
  );
}

export async function enqueuePing(item: Omit<QueuedPing, "id">): Promise<void> {
  const instance = await db();
  await instance.runAsync(
    `INSERT OR IGNORE INTO queued_pings
      (client_event_id, lat, lng, accuracy, speed, heading, battery_pct, provider, recorded_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      item.client_event_id,
      item.lat,
      item.lng,
      item.accuracy,
      item.speed,
      item.heading,
      item.battery_pct,
      item.provider,
      item.recorded_at,
      Date.now(),
    ]
  );
}

export async function queueSnapshot(): Promise<QueueSnapshot> {
  const instance = await db();
  const events = await instance.getFirstAsync<{ count: number }>(
    "SELECT COUNT(*) as count FROM queued_events"
  );
  const pings = await instance.getFirstAsync<{ count: number }>(
    "SELECT COUNT(*) as count FROM queued_pings"
  );
  const eventCount = events?.count || 0;
  const pingCount = pings?.count || 0;
  return { events: eventCount, pings: pingCount, total: eventCount + pingCount };
}

export async function takePending(
  eventLimit = 80,
  pingLimit = 120
): Promise<QueueBatch> {
  const instance = await db();
  const eventRows = await instance.getAllAsync<Omit<QueuedEvent, "meta"> & { meta: string }>(
    "SELECT id, client_event_id, type, occurred_at, meta FROM queued_events ORDER BY id ASC LIMIT ?",
    [eventLimit]
  );
  const pingRows = await instance.getAllAsync<QueuedPing>(
    `SELECT id, client_event_id, lat, lng, accuracy, speed, heading, battery_pct, provider, recorded_at
     FROM queued_pings ORDER BY id ASC LIMIT ?`,
    [pingLimit]
  );

  return {
    events: eventRows.map((row) => {
      let meta: Record<string, unknown> = {};
      try {
        meta = JSON.parse(row.meta || "{}");
      } catch {
        meta = {};
      }
      return { ...row, meta };
    }),
    pings: pingRows,
  };
}

export async function deleteQueued(eventIds: number[], pingIds: number[]) {
  const instance = await db();
  if (eventIds.length) {
    const placeholders = eventIds.map(() => "?").join(",");
    await instance.runAsync(
      `DELETE FROM queued_events WHERE id IN (${placeholders})`,
      eventIds
    );
  }
  if (pingIds.length) {
    const placeholders = pingIds.map(() => "?").join(",");
    await instance.runAsync(
      `DELETE FROM queued_pings WHERE id IN (${placeholders})`,
      pingIds
    );
  }
}

export async function clearQueue() {
  const instance = await db();
  await instance.execAsync("DELETE FROM queued_events; DELETE FROM queued_pings;");
}

export async function pruneQueue(maxAgeDays = 7) {
  const instance = await db();
  const cutoff = new Date(Date.now() - maxAgeDays * 86_400_000).toISOString();
  await instance.runAsync("DELETE FROM queued_events WHERE occurred_at < ?", [cutoff]);
  await instance.runAsync("DELETE FROM queued_pings WHERE recorded_at < ?", [cutoff]);
  await instance.runAsync(
    "DELETE FROM queued_events WHERE id NOT IN (SELECT id FROM queued_events ORDER BY id DESC LIMIT 5000)"
  );
  await instance.runAsync(
    "DELETE FROM queued_pings WHERE id NOT IN (SELECT id FROM queued_pings ORDER BY id DESC LIMIT 5000)"
  );
}
