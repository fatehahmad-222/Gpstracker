export function cn(...parts) {
  return parts.filter(Boolean).join(" ");
}

/** Great-circle distance in meters. */
export function haversine(lat1, lng1, lat2, lng2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export function formatDistance(meters) {
  if (meters == null || Number.isNaN(meters)) return "—";
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

export function isOnline(recordedAt, now = Date.now(), thresholdMs = 45_000) {
  if (!recordedAt) return false;
  return now - new Date(recordedAt).getTime() < thresholdMs;
}

export function timeAgo(iso, now = Date.now()) {
  if (!iso) return "never";
  const seconds = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 1000));
  if (seconds < 10) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

const dateTimeFmt = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

const timeFmt = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
});

const dateFmt = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric",
});

export function formatDateTime(iso) {
  if (!iso) return "—";
  return dateTimeFmt.format(new Date(iso));
}

export function formatTime(iso) {
  if (!iso) return "—";
  return timeFmt.format(new Date(iso));
}

export function formatDate(iso) {
  if (!iso) return "—";
  return dateFmt.format(new Date(iso));
}

export function toDateInputValue(date) {
  const d = new Date(date);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Returns { from, to } ISO strings for "today" in local time. */
export function todayRange() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return {
    from: start.toISOString(),
    to: now.toISOString(),
  };
}

/** Deterministic accent color for a name (used for map pins / avatars). */
export function colorForName(name = "", palette = []) {
  const key = name || "?";
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  }
  return palette[hash % palette.length];
}

export function initialsFor(name = "") {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function buildPinHtml({ name, color, isOnline, hasTask, selected, size = "md" }) {
  const cls = [
    "fleet-pin",
    isOnline ? "online" : "offline",
    hasTask ? "has-task" : "",
    selected ? "selected" : "",
    size === "sm" ? "sm" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const ring = isOnline ? '<span class="ring"></span>' : "";
  return `<div class="${cls}" style="background:${color}"><span class="letter">${escapeHtml(
    initialsFor(name)
  )}</span>${ring}</div>`;
}

export function escapeHtml(str = "") {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function debounce(fn, wait) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}
