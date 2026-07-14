/**
 * SQLite stores structured data as JSON strings. These helpers centralize
 * safe parse/stringify so callers never crash on malformed stored JSON.
 */

export function parseJson(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function stringifyJson(value) {
  return JSON.stringify(value ?? null);
}

/** Parse a JSON array string into an array, defaulting to []. */
export function parseArray(value) {
  const parsed = parseJson(value, []);
  return Array.isArray(parsed) ? parsed : [];
}
