import { describe, expect, it } from 'vitest';

import { classifySessionReview, isValidHumanReviewAnnotation, latestOwnedAnnotation } from './classifier';
import type { SessionAnnotation, SessionAnnotationConfig } from './types';

const categorical = {
  id: 'config-cat',
  name: 'quality',
  type: 'CATEGORICAL',
  values: [{ label: 'good', score: 1 }, { label: 'bad', score: 0 }],
} as SessionAnnotationConfig;
const continuous = {
  id: 'config-score',
  name: 'score',
  type: 'CONTINUOUS',
  lower_bound: 0,
  upper_bound: 10,
} as SessionAnnotationConfig;
const freeform = {
  id: 'config-comment',
  name: 'comment',
  type: 'FREEFORM',
} as SessionAnnotationConfig;

function annotation(
  name: string,
  result: SessionAnnotation['result'],
  annotatorKind: SessionAnnotation['annotator_kind'] = 'HUMAN'
): SessionAnnotation {
  return { name, result, annotator_kind: annotatorKind } as SessionAnnotation;
}

describe('session review annotation validity', () => {
  it('validates categorical, continuous, and freeform results against their configs', () => {
    expect(isValidHumanReviewAnnotation(annotation('quality', { label: 'good' }), categorical)).toBe(true);
    expect(isValidHumanReviewAnnotation(annotation('quality', { label: 'unknown' }), categorical)).toBe(false);
    expect(isValidHumanReviewAnnotation(annotation('score', { score: 0 }), continuous)).toBe(true);
    expect(isValidHumanReviewAnnotation(annotation('score', { score: 10 }), continuous)).toBe(true);
    expect(isValidHumanReviewAnnotation(annotation('score', { score: 11 }), continuous)).toBe(false);
    expect(isValidHumanReviewAnnotation(annotation('comment', { explanation: ' useful ' }), freeform)).toBe(true);
    expect(isValidHumanReviewAnnotation(annotation('comment', { explanation: '   ' }), freeform)).toBe(false);
  });

  it.each(['LLM', 'CODE'] as const)('ignores %s annotations', (kind) => {
    expect(isValidHumanReviewAnnotation(annotation('quality', { label: 'good' }, kind), categorical)).toBe(false);
  });

  it('ignores reserved note annotations even when human-authored', () => {
    const noteConfig = { ...freeform, name: 'note' } as SessionAnnotationConfig;
    expect(isValidHumanReviewAnnotation(annotation('note', { explanation: 'done' }), noteConfig)).toBe(false);
  });
});

describe('session review annotation ownership', () => {
  const ownedAnnotation = (identifier: string, userId: string | null, updatedAt: string) => ({
    annotator_kind: 'HUMAN',
    identifier,
    name: 'quality',
    result: { label: 'good' },
    updated_at: updatedAt,
    user_id: userId,
  }) as SessionAnnotation;

  it('requires both authenticated identifier and user ID', () => {
    const annotations = [
      ownedAnnotation('px-app:user-1', 'user-2', '2026-01-03T00:00:00Z'),
      ownedAnnotation('other', 'user-1', '2026-01-02T00:00:00Z'),
      ownedAnnotation('px-app:user-1', 'user-1', '2026-01-01T00:00:00Z'),
    ];
    expect(latestOwnedAnnotation(annotations, 'quality', 'px-app:user-1', 'user-1')).toBe(annotations[2]);
  });

  it('requires the persisted anonymous identifier and a null user ID', () => {
    const annotations = [
      ownedAnnotation('phoenix-mobile:annotation:local', 'user-1', '2026-01-03T00:00:00Z'),
      ownedAnnotation('phoenix-mobile:annotation:other', null, '2026-01-02T00:00:00Z'),
      ownedAnnotation('phoenix-mobile:annotation:local', null, '2026-01-01T00:00:00Z'),
    ];
    expect(latestOwnedAnnotation(
      annotations,
      'quality',
      'phoenix-mobile:annotation:local',
      null
    )).toBe(annotations[2]);
  });
});

describe('session review classification', () => {
  const configs = [categorical, continuous, freeform];

  it('classifies missing setup, unreviewed, partial, and complete sessions', () => {
    expect(classifySessionReview([], configs, []).status).toBe('not-configured');
    expect(classifySessionReview(['quality'], configs, []).status).toBe('unreviewed');
    expect(classifySessionReview(
      ['quality', 'score'],
      configs,
      [annotation('quality', { label: 'good' })]
    ).status).toBe('partial');
    expect(classifySessionReview(
      ['quality', 'score'],
      configs,
      [annotation('quality', { label: 'good' }), annotation('score', { score: 5 })]
    ).status).toBe('complete');
  });

  it('marks missing or now-invalid configured values as stale', () => {
    expect(classifySessionReview(['removed'], configs, [])).toMatchObject({
      status: 'stale',
      missingConfigNames: ['removed'],
    });
    expect(classifySessionReview(
      ['quality'],
      configs,
      [annotation('quality', { label: 'old-option' })]
    )).toMatchObject({ status: 'stale', invalidConfigNames: ['quality'] });
  });

  it('allows only valid HUMAN structured annotations to complete review', () => {
    const annotations = [
      annotation('quality', { label: 'good' }, 'LLM'),
      annotation('quality', { label: 'good' }, 'CODE'),
      annotation('note', { explanation: 'reviewed' }),
    ];
    expect(classifySessionReview(['quality'], configs, annotations).status).toBe('unreviewed');
  });
});
