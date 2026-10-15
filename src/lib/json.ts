export type JsonPrimitive = string | number | boolean | null;

export type JsonValue = JsonPrimitive | JsonValue[] | JsonObject;

export interface JsonObject {
  [key: string]: JsonValue;
}

/** Narrow a plain object (not an array, not null) without inspecting its members. */
export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isJsonArray(value: unknown): value is JsonValue[] {
  return Array.isArray(value);
}

export function isJsonString(value: unknown): value is string {
  return typeof value === 'string';
}

export function isJsonNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function isJsonBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean';
}

/**
 * Structural check used at I/O boundaries (AI SDK tool payloads, span attributes, JSON.parse
 * output). Accepts anything JSON.stringify can round-trip.
 */
export function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || isJsonString(value) || isJsonBoolean(value) || isJsonNumber(value)) {
    return true;
  }

  if (isJsonArray(value)) return value.every(isJsonValue);

  if (isJsonObject(value)) return Object.values(value).every(isJsonValue);

  return false;
}

/** Parse a JSON document into a JsonValue, returning null when the text is not JSON. */
export function parseJsonValue(text: string): JsonValue | null {
  try {
    const parsed: unknown = JSON.parse(text);

    return isJsonValue(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
