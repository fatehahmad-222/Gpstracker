export const OFFLINE_AFTER_MS = 45_000;
export const LOCATION_INSERT_MIN_INTERVAL_MS = 3_000;
export const MAX_HISTORY_POINTS = 4000;

export const TASK_STATUSES = ["pending", "in_progress", "completed", "cancelled"];

export const TASK_STATUS_META = {
  pending: { label: "Pending", color: "text-warning", dot: "bg-warning" },
  in_progress: { label: "In progress", color: "text-info", dot: "bg-info" },
  completed: { label: "Completed", color: "text-accent", dot: "bg-accent" },
  cancelled: { label: "Cancelled", color: "text-ink-dim", dot: "bg-ink-dim" },
};

export const MARKER_COLORS = [
  "#34e28a",
  "#60a5fa",
  "#f5a524",
  "#ef5a5a",
  "#a78bfa",
  "#f472b6",
  "#38bdf8",
  "#fb923c",
  "#4ade80",
  "#facc15",
];

export const NOMINATIM_ENDPOINT = "https://nominatim.openstreetmap.org/search";
export const PHOTON_ENDPOINT = "https://photon.komoot.io/api";

export const OVERPASS_ENDPOINT = "https://overpass-api.de/api/interpreter";
export const POI_MIN_ZOOM = 13;
export const POI_MAX_RESULTS = 200;
export const POI_QUERY = [
  '"shop"',
  '"amenity"~"^(pharmacy|clinic|hospital|restaurant|cafe|fast_food|bank|atm|fuel|supermarket|marketplace|school|parking)$"',
];
