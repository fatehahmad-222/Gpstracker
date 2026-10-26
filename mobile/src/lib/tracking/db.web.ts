import type { QueueBatch, QueueSnapshot, QueuedEvent, QueuedPing } from "./db-types";

const EVENT_KEY = "fleet.queue.events";
const PING_KEY = "fleet.queue.pings";
let nextId = 1;

function read<T>(key: string): T[] {
  try {
    const raw = globalThis.localStorage?.getItem(key);
    return raw ? (JSON.parse(raw) as T[]) : [];
  } catch {
    return [];
  }
}

function write<T>(key: string, rows: T[]) {
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify(rows));
  } catch {
    // Ignore storage pressure on the web preview.
  }
}

function withIds<T>(rows: T[]): Array<T & { id: number }> {
  return rows.map((row) => ({ ...row, id: nextId++ }));
}

export async function enqueueEvent(item: Omit<QueuedEvent, "id">) {
  const rows = read<QueuedEvent>(EVENT_KEY);
  if (rows.some((row) => row.client_event_id === item.client_event_id)) return;
  write(EVENT_KEY, [...rows, { ...item, id: nextId++ }].slice(-5000));
}

export async function enqueuePing(item: Omit<QueuedPing, "id">) {
  const rows = read<QueuedPing>(PING_KEY);
  if (rows.some((row) => row.client_event_id === item.client_event_id)) return;
  write(PING_KEY, [...rows, { ...item, id: nextId++ }].slice(-5000));
}

export async function queueSnapshot(): Promise<QueueSnapshot> {
  const events = read<unknown>(EVENT_KEY).length;
  const pings = read<unknown>(PING_KEY).length;
  return { events, pings, total: events + pings };
}

export async function takePending(eventLimit = 80, pingLimit = 120): Promise<QueueBatch> {
  return {
    events: read<QueuedEvent>(EVENT_KEY).slice(0, eventLimit),
    pings: read<QueuedPing>(PING_KEY).slice(0, pingLimit),
  };
}

export async function deleteQueued(eventIds: number[], pingIds: number[]) {
  const eventSet = new Set(eventIds);
  const pingSet = new Set(pingIds);
  write(
    EVENT_KEY,
    read<QueuedEvent>(EVENT_KEY).filter((row) => !eventSet.has(row.id))
  );
  write(
    PING_KEY,
    read<QueuedPing>(PING_KEY).filter((row) => !pingSet.has(row.id))
  );
}

export async function clearQueue() {
  write(EVENT_KEY, []);
  write(PING_KEY, []);
}

export async function pruneQueue(maxAgeDays = 7) {
  const cutoff = Date.now() - maxAgeDays * 86_400_000;
  write(
    EVENT_KEY,
    read<QueuedEvent>(EVENT_KEY).filter(
      (row) => Date.parse(row.occurred_at) >= cutoff
    )
  );
  write(
    PING_KEY,
    read<QueuedPing>(PING_KEY).filter(
      (row) => Date.parse(row.recorded_at) >= cutoff
    )
  );
}
