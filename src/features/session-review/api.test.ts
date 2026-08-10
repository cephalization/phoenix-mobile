import { describe, expect, it, vi } from 'vitest';
import {
  annotationConfigMatchesData,
  buildAnnotationConfigData,
  buildSessionAnnotationData,
  buildSessionDatasetUpload,
  compareVersions,
  createSessionAnnotationBatches,
  createAuthenticatedAnnotationIdentifier,
  createSessionReviewIdentifier,
  nextUnseenCursor,
  SessionReviewValidationError,
} from './api';
import type { SessionAnnotationConfig, SessionAnnotationDraft, SessionTurn } from './types';

vi.mock('@/lib/phoenix', () => ({ createPhoenixClient: vi.fn() }));

const categorical = {
  id: 'categorical',
  name: 'quality',
  type: 'CATEGORICAL',
  values: [{ label: 'good', score: 0.75 }, { label: 'bad', score: 0.1 }],
} as SessionAnnotationConfig;
const continuous = {
  id: 'continuous',
  name: 'score',
  type: 'CONTINUOUS',
  lower_bound: 1,
  upper_bound: 5,
} as SessionAnnotationConfig;
const freeform = {
  id: 'freeform',
  name: 'comment',
  type: 'FREEFORM',
} as SessionAnnotationConfig;

function build(config: SessionAnnotationConfig, draft: SessionAnnotationDraft) {
  return buildSessionAnnotationData({ config, draft, identifier: ' reviewer ', sessionId: ' session ' });
}

describe('review identifiers', () => {
  it('uses the authenticated Phoenix viewer GlobalID', () => {
    expect(createAuthenticatedAnnotationIdentifier(' VXNlcjox ')).toBe('px-app:VXNlcjox');
  });

  it('is stable per anonymous UUID and non-colliding for representative values', () => {
    const first = '11111111-1111-4111-8111-111111111111';
    const second = '22222222-2222-4222-8222-222222222222';
    expect(createSessionReviewIdentifier('annotation', first)).toBe(createSessionReviewIdentifier('annotation', first));
    expect(new Set([
      createSessionReviewIdentifier('annotation', first),
      createSessionReviewIdentifier('annotation', second),
      createSessionReviewIdentifier('note', first),
    ]).size).toBe(3);
  });
});

describe('annotation draft validation', () => {
  it('maps configured categorical labels to their configured score', () => {
    expect(build(categorical, { type: 'CATEGORICAL', label: 'good', explanation: ' clear ' })).toMatchObject({
      annotator_kind: 'HUMAN',
      identifier: 'reviewer',
      session_id: 'session',
      result: { label: 'good', score: 0.75, explanation: 'clear' },
    });
  });

  it('rejects unknown categorical labels and mismatched draft types', () => {
    expect(() => build(categorical, { type: 'CATEGORICAL', label: 'unknown' })).toThrow(SessionReviewValidationError);
    expect(() => build(categorical, { type: 'CONTINUOUS', score: 1 })).toThrow(SessionReviewValidationError);
  });

  it('accepts inclusive continuous bounds and rejects non-finite or out-of-range scores', () => {
    expect(build(continuous, { type: 'CONTINUOUS', score: 1 }).result).toEqual({ score: 1 });
    expect(build(continuous, { type: 'CONTINUOUS', score: 5 }).result).toEqual({ score: 5 });
    for (const score of [0, 6, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => build(continuous, { type: 'CONTINUOUS', score })).toThrow(SessionReviewValidationError);
    }
  });

  it('requires non-empty freeform text and forbids the reserved note config', () => {
    expect(build(freeform, { type: 'FREEFORM', explanation: ' useful ' }).result).toEqual({ explanation: 'useful' });
    expect(() => build(freeform, { type: 'FREEFORM', explanation: '  ' })).toThrow(SessionReviewValidationError);
    expect(() => build({ ...freeform, name: 'note' } as SessionAnnotationConfig, {
      type: 'FREEFORM',
      explanation: 'not a review',
    })).toThrow(SessionReviewValidationError);
  });
});

describe('session dataset uploads', () => {
  const turn = (spanId: string, input?: string, output?: string): SessionTurn => ({
    endTime: '2026-08-08T00:01:00Z',
    startTime: '2026-08-08T00:00:00Z',
    traceId: `trace-${spanId}`,
    ...(spanId
      ? {
          rootSpan: {
            context: { span_id: spanId, trace_id: `trace-${spanId}` },
            name: 'handle_user_message',
            start_time: '2026-08-08T00:00:00Z',
          } as SessionTurn['rootSpan'],
          ...(input != null ? { input: { value: input } } : {}),
          ...(output != null ? { output: { value: output } } : {}),
        }
      : {}),
  });

  it('maps turns to parallel example arrays with span links and skips rootless turns', () => {
    const { body, skippedTurnCount } = buildSessionDatasetUpload({
      action: 'append',
      datasetName: ' flagged ',
      sessionId: ' session-1 ',
      turns: [turn('aaa', 'question', 'answer'), turn(''), turn('bbb', 'follow-up')],
    });
    expect(skippedTurnCount).toBe(1);
    expect(body).toEqual({
      action: 'append',
      name: 'flagged',
      inputs: [{ input: 'question' }, { input: 'follow-up' }],
      outputs: [{ output: 'answer' }, { output: '' }],
      metadata: [
        {
          session_id: 'session-1',
          source: 'phoenix-mobile',
          span_name: 'handle_user_message',
          start_time: '2026-08-08T00:00:00Z',
          trace_id: 'trace-aaa',
        },
        {
          session_id: 'session-1',
          source: 'phoenix-mobile',
          span_name: 'handle_user_message',
          start_time: '2026-08-08T00:00:00Z',
          trace_id: 'trace-bbb',
        },
      ],
      span_ids: ['aaa', 'bbb'],
    });
  });

  it('includes the description only when creating', () => {
    const create = buildSessionDatasetUpload({
      action: 'create',
      datasetName: 'flagged',
      description: ' first pass ',
      sessionId: 'session-1',
      turns: [turn('aaa')],
    });
    expect(create.body.description).toBe('first pass');
    const append = buildSessionDatasetUpload({
      action: 'append',
      datasetName: 'flagged',
      description: 'ignored',
      sessionId: 'session-1',
      turns: [turn('aaa')],
    });
    expect(append.body.description).toBeUndefined();
  });

  it('rejects empty names and sessions without a usable turn', () => {
    expect(() => buildSessionDatasetUpload({
      action: 'create',
      datasetName: '  ',
      sessionId: 'session-1',
      turns: [turn('aaa')],
    })).toThrow(SessionReviewValidationError);
    expect(() => buildSessionDatasetUpload({
      action: 'append',
      datasetName: 'flagged',
      sessionId: 'session-1',
      turns: [turn('')],
    })).toThrow(SessionReviewValidationError);
  });
});

describe('annotation config creation', () => {
  it('builds a categorical config with trimmed unique labels and optional scores', () => {
    expect(buildAnnotationConfigData({
      name: ' quality ',
      description: ' overall quality ',
      draft: {
        type: 'CATEGORICAL',
        optimizationDirection: 'MAXIMIZE',
        values: [{ label: ' good ', score: 1 }, { label: 'bad' }],
      },
    })).toEqual({
      name: 'quality',
      description: 'overall quality',
      type: 'CATEGORICAL',
      optimization_direction: 'MAXIMIZE',
      values: [{ label: 'good', score: 1 }, { label: 'bad' }],
    });
  });

  it('rejects empty, duplicate, and non-numeric categorical values', () => {
    const build = (values: { label: string; score?: number }[]) => () =>
      buildAnnotationConfigData({
        name: 'quality',
        draft: { type: 'CATEGORICAL', optimizationDirection: 'NONE', values },
      });
    expect(build([])).toThrow(SessionReviewValidationError);
    expect(build([{ label: '  ' }])).toThrow(SessionReviewValidationError);
    expect(build([{ label: 'good' }, { label: ' good ' }])).toThrow(SessionReviewValidationError);
    expect(build([{ label: 'good', score: Number.NaN }])).toThrow(SessionReviewValidationError);
  });

  it('builds continuous configs with optional ordered bounds and bare freeform configs', () => {
    expect(buildAnnotationConfigData({
      name: 'score',
      draft: { type: 'CONTINUOUS', optimizationDirection: 'MINIMIZE', lowerBound: 1, upperBound: 5 },
    })).toEqual({
      name: 'score',
      type: 'CONTINUOUS',
      optimization_direction: 'MINIMIZE',
      lower_bound: 1,
      upper_bound: 5,
    });
    expect(buildAnnotationConfigData({
      name: 'comment',
      draft: { type: 'FREEFORM' },
    })).toEqual({ name: 'comment', type: 'FREEFORM' });
    expect(() => buildAnnotationConfigData({
      name: 'score',
      draft: { type: 'CONTINUOUS', optimizationDirection: 'NONE', lowerBound: 5, upperBound: 1 },
    })).toThrow(SessionReviewValidationError);
    expect(() => buildAnnotationConfigData({
      name: 'score',
      draft: { type: 'CONTINUOUS', optimizationDirection: 'NONE', lowerBound: Number.NaN },
    })).toThrow(SessionReviewValidationError);
  });

  it('rejects blank names and the reserved note name', () => {
    expect(() => buildAnnotationConfigData({ name: '  ', draft: { type: 'FREEFORM' } }))
      .toThrow(SessionReviewValidationError);
    expect(() => buildAnnotationConfigData({ name: ' note ', draft: { type: 'FREEFORM' } }))
      .toThrow(SessionReviewValidationError);
  });

  it('matches an existing config only when the shape is identical', () => {
    const data = buildAnnotationConfigData({
      name: 'quality',
      draft: {
        type: 'CATEGORICAL',
        optimizationDirection: 'MAXIMIZE',
        values: [{ label: 'good', score: 1 }, { label: 'bad', score: 0 }],
      },
    });
    const existing = {
      id: 'config-1',
      name: 'quality',
      type: 'CATEGORICAL',
      optimization_direction: 'MAXIMIZE',
      values: [{ label: 'good', score: 1 }, { label: 'bad', score: 0 }],
    } as SessionAnnotationConfig;
    expect(annotationConfigMatchesData(existing, data)).toBe(true);
    expect(annotationConfigMatchesData({ ...existing, description: 'other' } as SessionAnnotationConfig, data)).toBe(false);
    expect(annotationConfigMatchesData(
      { ...existing, values: [{ label: 'good', score: 1 }] } as SessionAnnotationConfig,
      data
    )).toBe(false);
    expect(annotationConfigMatchesData(
      { id: 'config-2', name: 'quality', type: 'FREEFORM' } as SessionAnnotationConfig,
      data
    )).toBe(false);
  });
});

describe('pagination and compatibility helpers', () => {
  it('batches annotations by session page while deduplicating inclusive page boundaries', () => {
    const firstPage = Array.from({ length: 40 }, (_, index) => `session-${index}`);
    const oversizedPage = Array.from({ length: 55 }, (_, index) => `older-${index}`);
    expect(createSessionAnnotationBatches([
      firstPage,
      [firstPage[39], ...oversizedPage, '  '],
    ])).toEqual([
      firstPage,
      oversizedPage.slice(0, 50),
      oversizedPage.slice(50),
    ]);
  });

  it('stops repeated cursors while accepting a new cursor once', () => {
    const seen = new Set<string>();
    expect(nextUnseenCursor('cursor-1', seen)).toBe('cursor-1');
    expect(nextUnseenCursor('cursor-1', seen)).toBeNull();
    expect(nextUnseenCursor(null, seen)).toBeNull();
  });

  it('compares differently sized semantic version tuples', () => {
    expect(compareVersions([19, 6], [19, 6, 0])).toBe(0);
    expect(compareVersions([19, 6, 1], [19, 6])).toBeGreaterThan(0);
    expect(compareVersions([18, 99], [19, 0])).toBeLessThan(0);
  });
});
