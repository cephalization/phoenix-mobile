import { describe, expect, it } from 'vite-plus/test';

import { describeOperation, describeStatus, shortSessionId } from './outbox-describe';
import type { OutboxOperation } from './outbox-model';

const entry = {
  id: 'op',
  instanceId: 'local',
  createdAt: 0,
  attempts: 0,
  status: 'queued',
} as const;

describe('describeOperation', () => {
  it('names a review by its session tail and annotation count', () => {
    const operation: OutboxOperation = {
      ...entry,
      kind: 'sessionAnnotations',
      projectId: 'project',
      payload: {
        annotations: ['quality', 'tone', 'safety'].map((name) => ({
          annotator_kind: 'HUMAN',
          name,
          session_id: 'c0ffee0034ab497b',
        })),
      },
    };

    expect(describeOperation(operation)).toBe('Review for session …34ab497b · 3 annotations');
  });

  it('describes notes, dataset adds, and annotation configs', () => {
    expect(
      describeOperation({
        ...entry,
        kind: 'sessionNote',
        projectId: 'project',
        payload: { identifier: 'id', note: 'Looks off', sessionId: 'abc' },
      }),
    ).toBe('Note on session abc');

    expect(
      describeOperation({
        ...entry,
        kind: 'addSessionToDataset',
        payload: {
          sessionId: 'session-0123456789',
          body: {
            action: 'create',
            name: 'regressions',
            inputs: [],
            outputs: [],
            metadata: [],
            span_ids: [],
          },
        },
      }),
    ).toBe('Add session …23456789 to regressions (new)');

    expect(
      describeOperation({
        ...entry,
        kind: 'createAnnotationConfig',
        projectId: 'project',
        payload: { name: ' quality ', draft: { type: 'FREEFORM' } },
      }),
    ).toBe('Annotation config “quality”');
  });
});

describe('describeStatus', () => {
  const base: OutboxOperation = {
    ...entry,
    kind: 'sessionNote',
    projectId: 'project',
    payload: { identifier: 'id', note: 'n', sessionId: 's' },
  };

  it('reads waiting, retrying, uploading, and failed', () => {
    expect(describeStatus(base)).toBe('Waiting to upload');
    expect(describeStatus({ ...base, lastError: '503' })).toBe('Will retry · 503');
    expect(describeStatus({ ...base, status: 'sending' })).toBe('Uploading…');
    expect(describeStatus({ ...base, status: 'failed', lastError: 'Forbidden' })).toBe('Forbidden');
  });
});

describe('shortSessionId', () => {
  it('keeps short IDs whole', () => {
    expect(shortSessionId('abc')).toBe('abc');
    expect(shortSessionId('1234567890')).toBe('…34567890');
  });
});
