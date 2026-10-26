export function bearerFromHeader(value) {
  const match = /^Bearer\s+(.+)$/i.exec(String(value || "").trim());
  return match ? match[1].trim() || null : null;
}
