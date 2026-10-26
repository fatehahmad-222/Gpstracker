export function initials(name?: string | null) {
  if (!name) return "FC";
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

export function greeting(date = new Date()) {
  const hour = date.getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

export function firstName(name?: string | null) {
  return name?.trim().split(/\s+/)[0] || "there";
}

export function companyToday(timezone?: string) {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone || "Asia/Karachi",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

export function shiftDate(date: string, days: number) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function formatTime(value?: string | null, timezone?: string) {
  if (!value) return "—";
  try {
    return new Intl.DateTimeFormat("en", {
      timeZone: timezone,
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(value));
  } catch {
    return "—";
  }
}

export function formatDate(value?: string | null, options?: Intl.DateTimeFormatOptions) {
  if (!value) return "—";
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T12:00:00Z`)
    : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en", options ?? { month: "short", day: "numeric" }).format(date);
}

export function formatDuration(seconds?: number | null) {
  if (!seconds || seconds < 0) return "0m";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  if (!hours) return `${minutes}m`;
  return `${hours}h ${minutes}m`;
}

export function timeAgo(value?: string | null) {
  if (!value) return "Never";
  const seconds = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 45) return "Just now";
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h ago`;
  return `${Math.round(seconds / 86400)}d ago`;
}

function clockValue(value: string | number | null | undefined) {
  if (value == null || value === "") return null;
  const raw = String(value).trim();

  if (/^\d{1,2}:\d{2}/.test(raw)) return raw.slice(0, 5);

  // `employees.shift_start` stores minutes from midnight, while bootstrap can
  // surface the same column directly. Normalise both to HH:MM.
  if (/^\d{1,4}$/.test(raw)) {
    const total = Number(raw);
    if (Number.isFinite(total) && total >= 0 && total < 24 * 60) {
      return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
    }
  }

  return null;
}

export function shiftWindow(
  start?: string | number | null,
  end?: string | number | null
) {
  const from = clockValue(start);
  const to = clockValue(end);
  if (!from || !to) return "No shift set";
  return `${from} – ${to}`;
}

export function titleCase(value?: string | null) {
  if (!value) return "";
  return value.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

export function percent(value?: number | null) {
  return `${Math.max(0, Math.round(value || 0))}%`;
}
