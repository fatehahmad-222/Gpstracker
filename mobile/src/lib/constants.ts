export const APP_NAME = "Fleet Console";
export const APP_VERSION = "1.0.0";

export const STORAGE_KEYS = {
  deviceToken: "fleet.device.token",
  deviceRevoked: "fleet.device.revoked",
  installId: "fleet.install.id",
  trackingActive: "fleet.tracking.active",
  trackingLastSync: "fleet.tracking.lastSync",
  pushToken: "fleet.push.token",
  onboardingSeen: "fleet.onboarding.seen",
};

export const QUERY_KEYS = {
  bootstrap: ["bootstrap"] as const,
  tasks: (scope: string) => ["tasks", scope] as const,
  task: (id: string) => ["task", id] as const,
  attendance: (scope: string, date: string) => ["attendance", scope, date] as const,
  leaves: (scope: string) => ["leaves", scope] as const,
  dashboard: (date: string) => ["dashboard", date] as const,
  positions: ["positions"] as const,
  team: (query: string) => ["team", query] as const,
  alerts: ["alerts"] as const,
};

export const LOCATION_TASK = "fleet-console-location-v1";

export const BRAND = {
  bg: "#07111F",
  surface: "#0D1B2E",
  brand: "#3B82F6",
  cyan: "#22D3EE",
  ok: "#34D399",
  warn: "#FBBF24",
  danger: "#FB7185",
  ink: "#E8F1FB",
  dim: "#8FA6C0",
};

export const OSM_STYLE = {
  version: 8,
  sources: {
    osm: {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: "© OpenStreetMap contributors",
    },
  },
  layers: [
    {
      id: "osm",
      type: "raster",
      source: "osm",
      minzoom: 0,
      maxzoom: 19,
    },
  ],
} as const;
