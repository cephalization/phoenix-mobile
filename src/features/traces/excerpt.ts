import {
  isJsonArray,
  isJsonObject,
  isJsonString,
  type JsonValue,
  parseJsonValue,
} from '@/lib/json';

const ExcerptLength = 140;

/** Keys that hold what a person typed, in the order they are preferred. */
const TextKeys = ['content', 'text', 'query', 'question', 'input', 'prompt', 'message'];

/**
 * One line of a span's input for a list row: the last user message of a chat
 * payload, the first text field of other JSON, or the plain text itself.
 * Returns null when there is nothing readable.
 */
export function inputExcerpt(value: JsonValue | undefined): string | null {
  if (!isJsonString(value) || value.trim().length === 0) return null;
  const parsed = /^\s*[[{]/.test(value) ? parseJsonValue(value) : null;
  const text = parsed === null ? value : readableText(parsed);

  if (text === null) return null;
  const line = text.replace(/\s+/g, ' ').trim();

  if (line.length === 0) return null;

  return line.length > ExcerptLength ? `${line.slice(0, ExcerptLength - 1)}…` : line;
}

function readableText(value: JsonValue): string | null {
  if (isJsonString(value)) return value;

  if (isJsonArray(value)) {
    const lastUser = [...value]
      .reverse()
      .find((item) => isJsonObject(item) && item.role === 'user');

    if (lastUser !== undefined) return readableText(lastUser);

    for (const item of value) {
      const text = readableText(item);

      if (text !== null) return text;
    }

    return null;
  }

  if (!isJsonObject(value)) return null;

  if (isJsonArray(value.messages)) return readableText(value.messages);

  for (const key of TextKeys) {
    const field = value[key];

    if (field === undefined) continue;
    const text = readableText(field);

    if (text !== null) return text;
  }

  return null;
}
