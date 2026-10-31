import type { PhoenixSpan } from '@/hooks/use-phoenix-data';
import { isJsonNumber, isJsonObject, isJsonString, type JsonObject } from '@/lib/json';

/**
 * Pure helpers for the trace detail page: the span tree, the shared timeline,
 * token totals, and the Phoenix web link. Kept free of React Native so they run
 * under Vitest.
 */

export type TimelineItem = {
  depth: number;
  span: PhoenixSpan;
  /** Offset of the span's start from the trace start, as a fraction of the trace. */
  offset: number;
  /** The span's duration as a fraction of the trace. */
  extent: number;
};

export type TokenCounts = {
  completion: number;
  prompt: number;
  total: number;
};

export type TraceWindow = {
  start: number;
  end: number;
  duration: number;
};

export function findRootSpan(spans: PhoenixSpan[]) {
  return spans.find((span) => span.parent_id == null) ?? [...spans].sort(compareStart)[0];
}

/** The window every span bar is placed on: earliest start to latest end. */
export function traceWindow(spans: PhoenixSpan[]): TraceWindow {
  if (spans.length === 0) return { start: 0, end: 0, duration: 0 };
  const start = Math.min(...spans.map((span) => timeOf(span.start_time)));
  const end = Math.max(...spans.map((span) => timeOf(span.end_time)));

  return { start, end, duration: Math.max(0, end - start) };
}

/** Depth-first span tree, siblings by start time, orphans appended as roots. */
export function buildTimeline(spans: PhoenixSpan[], window: TraceWindow): TimelineItem[] {
  const children = new Map<string | null, PhoenixSpan[]>();

  for (const span of spans) {
    const parentId = span.parent_id ?? null;
    children.set(parentId, [...(children.get(parentId) ?? []), span]);
  }

  for (const siblings of children.values()) siblings.sort(compareStart);

  const result: TimelineItem[] = [];
  const visited = new Set<string>();

  const visit = (span: PhoenixSpan, depth: number) => {
    if (visited.has(span.context.span_id)) return;
    visited.add(span.context.span_id);
    result.push({ depth, span, ...placement(span, window) });

    for (const child of children.get(span.context.span_id) ?? []) visit(child, depth + 1);
  };

  for (const root of children.get(null) ?? []) visit(root, 0);

  for (const span of [...spans].sort(compareStart)) visit(span, 0);

  return result;
}

function placement(span: PhoenixSpan, window: TraceWindow) {
  if (window.duration <= 0) return { offset: 0, extent: 1 };
  const offset = clamp((timeOf(span.start_time) - window.start) / window.duration, 0, 1);
  const extent = clamp(spanDuration(span) / window.duration, 0, 1 - offset);

  return { offset, extent };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function timeOf(value: string) {
  return new Date(value).getTime();
}

function compareStart(left: PhoenixSpan, right: PhoenixSpan) {
  return timeOf(left.start_time) - timeOf(right.start_time);
}

export function spanDuration(span: PhoenixSpan) {
  return Math.max(0, timeOf(span.end_time) - timeOf(span.start_time));
}

/** Milliseconds from the trace start to the span's start. */
export function spanOffset(span: PhoenixSpan, window: TraceWindow) {
  return Math.max(0, timeOf(span.start_time) - window.start);
}

/** Span attributes are JSON parsed from the Phoenix response body. */
export function spanAttributes(span: PhoenixSpan): JsonObject | null {
  return isJsonObject(span.attributes) ? span.attributes : null;
}

export function stringAttribute(span: PhoenixSpan, key: string): string | null {
  const value = spanAttributes(span)?.[key];

  return isJsonString(value) && value.length > 0 ? value : null;
}

function numericAttribute(span: PhoenixSpan, key: string) {
  const value = spanAttributes(span)?.[key];

  if (isJsonNumber(value)) return value;

  if (isJsonString(value)) {
    const parsed = Number(value);

    if (Number.isFinite(parsed)) return parsed;
  }

  return 0;
}

export function tokenCounts(span: PhoenixSpan): TokenCounts {
  const prompt =
    numericAttribute(span, 'llm.token_count.prompt') ||
    numericAttribute(span, 'gen_ai.usage.input_tokens');

  const completion =
    numericAttribute(span, 'llm.token_count.completion') ||
    numericAttribute(span, 'gen_ai.usage.output_tokens');

  const total = numericAttribute(span, 'llm.token_count.total') || prompt + completion;

  return { completion, prompt, total };
}

/**
 * Trace token totals. LLM spans carry the real counts; parents often repeat
 * them as rollups, so only LLM spans are summed when any exist.
 */
export function sumTokens(spans: PhoenixSpan[]): TokenCounts {
  const llmSpans = spans.filter((span) => span.span_kind.toUpperCase() === 'LLM');

  return (llmSpans.length > 0 ? llmSpans : spans).reduce<TokenCounts>(
    (total, span) => {
      const counts = tokenCounts(span);

      return {
        completion: total.completion + counts.completion,
        prompt: total.prompt + counts.prompt,
        total: total.total + counts.total,
      };
    },
    { completion: 0, prompt: 0, total: 0 },
  );
}

export function isErrorSpan(span: PhoenixSpan) {
  return span.status_code === 'ERROR';
}

/** The exception message when the span recorded one, else its status message. */
export function errorSummary(span: PhoenixSpan) {
  const exception = span.events?.find((event) => event.name.toLowerCase() === 'exception');
  const message = exception?.attributes?.['exception.message'];

  if (isJsonString(message) && message) return message;

  return span.status_message || 'The span ended with an error status.';
}

/** The error a reader should see first: the root's, else the earliest failing span's. */
export function primaryError(spans: PhoenixSpan[], root: PhoenixSpan) {
  if (isErrorSpan(root)) return root;

  return [...spans].filter(isErrorSpan).sort(compareStart)[0];
}

export function formatKind(kind: string) {
  const normalized = kind.toUpperCase();

  if (normalized === 'LLM') return 'LLM';

  return normalized.charAt(0) + normalized.slice(1).toLowerCase();
}

export function formatStatus(status: string) {
  if (status === 'ERROR') return 'Error';

  if (status === 'OK') return 'OK';

  return 'Unset';
}

/** `a1b2c3d4…`: enough of an ID to recognise; the full value is one copy away. */
export function shortId(id: string, length = 8) {
  return id.length > length ? `${id.slice(0, length)}…` : id;
}

/** Phoenix's web UI resolves a trace by its OpenTelemetry ID through this redirect. */
export function phoenixTraceUrl(baseUrl: string, traceId: string) {
  return `${baseUrl.replace(/\/+$/, '')}/redirects/traces/${encodeURIComponent(traceId)}`;
}
