export type QueuedEvent = {
  id: number;
  client_event_id: string;
  type: string;
  occurred_at: string;
  meta: Record<string, unknown>;
};

export type QueuedPing = {
  id: number;
  client_event_id: string;
  lat: number;
  lng: number;
  accuracy: number | null;
  speed: number | null;
  heading: number | null;
  battery_pct: number | null;
  provider: string | null;
  recorded_at: string;
};

export type QueueSnapshot = {
  events: number;
  pings: number;
  total: number;
};

export type QueueBatch = {
  events: QueuedEvent[];
  pings: QueuedPing[];
};
