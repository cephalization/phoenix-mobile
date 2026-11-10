import { describe, expect, it } from 'vite-plus/test';

import { parseJsonValue } from '@/lib/json';

import {
  countPending,
  hasUnsent,
  isStorableDraft,
  type OutboxOperation,
  replayQueue,
  type ReplayOutcome,
  restoreOutbox,
  settleOperation,
} from './outbox-model';

function note(
  id: string,
  overrides: Partial<Pick<OutboxOperation, 'status' | 'attempts' | 'instanceId'>> = {},
): OutboxOperation {
  return {
    id,
    instanceId: overrides.instanceId ?? 'local',
    createdAt: 1,
    attempts: overrides.attempts ?? 0,
    status: overrides.status ?? 'queued',
    kind: 'sessionNote',
    projectId: 'project',
    payload: { identifier: 'phoenix-mobile:note:device', note: `note ${id}`, sessionId: 'session' },
  };
}

function review(id: string): OutboxOperation {
  return {
    id,
    instanceId: 'local',
    createdAt: 2,
    attempts: 0,
    status: 'queued',
    kind: 'sessionAnnotations',
    projectId: 'project',
    payload: {
      annotations: [
        {
          annotator_kind: 'HUMAN',
          identifier: 'px-app:viewer',
          metadata: { client: 'phoenix-mobile' },
          name: 'quality',
          result: { label: 'good', score: 1 },
          session_id: 'session-1234567890',
        },
      ],
    },
  };
}

function scripted(outcomes: Record<string, ReplayOutcome>) {
  const sent: string[] = [];

  return {
    sent,
    send: async (operation: OutboxOperation): Promise<ReplayOutcome> => {
      sent.push(operation.id);

      return outcomes[operation.id] ?? { type: 'sent' };
    },
  };
}

describe('replayQueue', () => {
  it('sends oldest first and empties the queue on success', async () => {
    const { send, sent } = scripted({});
    const result = await replayQueue([note('a'), review('b'), note('c')], 'local', send);

    expect(sent).toEqual(['a', 'b', 'c']);
    expect(result).toEqual({ operations: [], result: 'drained' });
  });

  it('stops at a network failure and keeps that change and the rest queued', async () => {
    const { send, sent } = scripted({ b: { type: 'offline' } });
    const result = await replayQueue([note('a'), note('b'), note('c')], 'local', send);

    expect(sent).toEqual(['a', 'b']);
    expect(result.result).toBe('offline');
    expect(result.operations.map((operation) => [operation.id, operation.status])).toEqual([
      ['b', 'queued'],
      ['c', 'queued'],
    ]);
    expect(result.operations[0].attempts).toBe(0);
  });

  it('parks a rejected change as failed and continues with the next', async () => {
    const { send, sent } = scripted({ a: { type: 'rejected', message: 'Forbidden: 403' } });
    const result = await replayQueue([note('a'), note('b')], 'local', send);

    expect(sent).toEqual(['a', 'b']);
    expect(result.result).toBe('drained');
    expect(result.operations).toEqual([
      { ...note('a'), attempts: 1, status: 'failed', lastError: 'Forbidden: 403' },
    ]);
  });

  it('pauses on a retryable error so later changes keep their order', async () => {
    const { send, sent } = scripted({ a: { type: 'retryable', message: '503' } });
    const result = await replayQueue([note('a'), note('b')], 'local', send);

    expect(sent).toEqual(['a']);
    expect(result.result).toBe('paused');
    expect(result.operations[0]).toMatchObject({ attempts: 1, status: 'queued', lastError: '503' });
  });

  it('fails a change once it has used its attempts and moves on', async () => {
    const { send, sent } = scripted({ a: { type: 'retryable', message: '503' } });
    const result = await replayQueue([note('a', { attempts: 2 }), note('b')], 'local', send, 3);

    expect(sent).toEqual(['a', 'b']);
    expect(result.operations).toEqual([
      { ...note('a'), attempts: 3, status: 'failed', lastError: '503' },
    ]);
  });

  it('skips failed changes and other instances', async () => {
    const { send, sent } = scripted({});

    const result = await replayQueue(
      [note('a', { status: 'failed' }), note('b', { instanceId: 'other' }), note('c')],
      'local',
      send,
    );

    expect(sent).toEqual(['c']);
    expect(result.operations.map((operation) => operation.id)).toEqual(['a', 'b']);
  });
});

describe('settleOperation', () => {
  it('removes a sent change', () => {
    expect(settleOperation(note('a'), { type: 'sent' })).toBeNull();
  });

  it('does not count a network failure as an attempt', () => {
    expect(settleOperation(note('a', { status: 'sending' }), { type: 'offline' })).toEqual(
      note('a'),
    );
  });
});

describe('restoreOutbox', () => {
  it('round-trips valid operations through JSON', () => {
    const stored = parseJsonValue(JSON.stringify({ operations: [note('a'), review('b')] }));

    expect(restoreOutbox(stored ?? undefined)).toEqual({
      operations: [note('a'), review('b')],
      droppedCount: 0,
    });
  });

  it('drops invalid entries and keeps the rest', () => {
    const stored = parseJsonValue(
      JSON.stringify({
        operations: [
          note('a'),
          { ...note('b'), kind: 'somethingNew' },
          { ...review('c'), payload: { annotations: [{ name: 'quality' }] } },
          'garbage',
        ],
      }),
    );

    const restored = restoreOutbox(stored ?? undefined);

    expect(restored.operations.map((operation) => operation.id)).toEqual(['a']);
    expect(restored.droppedCount).toBe(3);
  });

  it('requeues a change the app closed while sending', () => {
    const stored = parseJsonValue(
      JSON.stringify({ operations: [note('a', { status: 'sending' })] }),
    );

    expect(restoreOutbox(stored ?? undefined).operations[0].status).toBe('queued');
  });

  it('treats missing or malformed storage as empty', () => {
    expect(restoreOutbox(undefined)).toEqual({ operations: [], droppedCount: 0 });
    expect(restoreOutbox({ operations: 'nope' })).toEqual({ operations: [], droppedCount: 0 });
  });
});

describe('isStorableDraft', () => {
  it('accepts a dataset add with JSON rows', () => {
    expect(
      isStorableDraft({
        instanceId: 'local',
        kind: 'addSessionToDataset',
        payload: {
          sessionId: 'session',
          body: {
            action: 'create',
            name: 'flagged',
            inputs: [{ input: 'hi' }],
            outputs: [{ output: 'hello' }],
            metadata: [{ session_id: 'session', source: 'phoenix-mobile' }],
            span_ids: ['span'],
          },
        },
      }),
    ).toBe(true);
  });

  it('rejects a note with no text', () => {
    expect(
      isStorableDraft({
        instanceId: 'local',
        kind: 'sessionNote',
        projectId: 'project',
        payload: { identifier: 'id', note: '', sessionId: 'session' },
      }),
    ).toBe(false);
  });
});

describe('pending counts', () => {
  const operations = [
    note('a'),
    note('b', { status: 'failed' }),
    note('c', { instanceId: 'other' }),
  ];

  it('counts failed changes as pending but not as unsent', () => {
    expect(countPending(operations, 'local')).toBe(2);
    expect(hasUnsent([note('b', { status: 'failed' })], 'local')).toBe(false);
    expect(hasUnsent(operations, 'local')).toBe(true);
  });
});
