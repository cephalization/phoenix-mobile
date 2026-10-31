import { describe, expect, it } from 'vitest';

import type { PhoenixSpan } from '@/hooks/use-phoenix-data';

import {
  buildTimeline,
  findRootSpan,
  phoenixTraceUrl,
  primaryError,
  shortId,
  sumTokens,
  traceWindow,
} from './trace-detail-model';

function span(
  spanId: string,
  parentId: string | null,
  startMs: number,
  endMs: number,
  extra: Partial<PhoenixSpan> = {},
): PhoenixSpan {
  return {
    attributes: {},
    context: { span_id: spanId, trace_id: 'trace-1' },
    end_time: new Date(Date.UTC(2026, 0, 1) + endMs).toISOString(),
    name: spanId,
    parent_id: parentId,
    span_kind: 'CHAIN',
    start_time: new Date(Date.UTC(2026, 0, 1) + startMs).toISOString(),
    status_code: 'OK',
    ...extra,
  };
}

describe('buildTimeline', () => {
  it('orders depth first and places bars on the trace window', () => {
    const spans = [
      span('late-child', 'root', 600, 1000),
      span('root', null, 0, 1000),
      span('early-child', 'root', 0, 500),
      span('grandchild', 'early-child', 250, 500),
    ];

    const window = traceWindow(spans);
    const timeline = buildTimeline(spans, window);

    expect(window.duration).toBe(1000);
    expect(timeline.map((item) => [item.span.name, item.depth])).toEqual([
      ['root', 0],
      ['early-child', 1],
      ['grandchild', 2],
      ['late-child', 1],
    ]);
    expect(timeline[2]).toMatchObject({ offset: 0.25, extent: 0.25 });
    expect(timeline[3]).toMatchObject({ offset: 0.6, extent: 0.4 });
  });

  it('keeps orphans and fills the track when the trace has no duration', () => {
    const spans = [span('root', null, 0, 0), span('orphan', 'missing', 0, 0)];
    const timeline = buildTimeline(spans, traceWindow(spans));

    expect(timeline.map((item) => item.span.name)).toEqual(['root', 'orphan']);
    expect(timeline[0]).toMatchObject({ offset: 0, extent: 1 });
  });
});

describe('trace summaries', () => {
  it('sums LLM spans only when any exist', () => {
    const spans = [
      span('root', null, 0, 10, { attributes: { 'llm.token_count.total': 300 } }),
      span('llm', 'root', 0, 10, {
        attributes: { 'llm.token_count.completion': 50, 'llm.token_count.prompt': '100' },
        span_kind: 'LLM',
      }),
    ];

    expect(sumTokens(spans)).toEqual({ completion: 50, prompt: 100, total: 150 });
  });

  it('prefers the root error, then the earliest failing span', () => {
    const root = span('root', null, 0, 10);
    const late = span('late', 'root', 8, 10, { status_code: 'ERROR' });
    const early = span('early', 'root', 2, 10, { status_code: 'ERROR' });

    expect(findRootSpan([late, root, early])).toBe(root);
    expect(primaryError([late, root, early], root)).toBe(early);
    expect(primaryError([root], root)).toBeUndefined();
  });

  it('shortens IDs and builds the Phoenix redirect', () => {
    expect(shortId('a1b2c3d4e5f6')).toBe('a1b2c3d4…');
    expect(shortId('a1b2')).toBe('a1b2');
    expect(phoenixTraceUrl('http://phoenix.local:6006//', 'abc')).toBe(
      'http://phoenix.local:6006/redirects/traces/abc',
    );
  });
});
