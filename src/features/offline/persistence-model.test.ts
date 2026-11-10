import { hashKey } from '@tanstack/react-query';
import { describe, expect, it } from 'vite-plus/test';

import {
  deserializePersistedQuery,
  isPersistableQueryKey,
  normalizeQueryHash,
  OfflineCacheBuster,
  OfflineCacheMaxAgeMs,
  OfflineCachePrefix,
  offlineStorageKey,
  parseOfflineIndex,
  planOfflineEviction,
  planOfflineSweep,
  recoveredInstanceIds,
  serializeOfflineIndex,
  serializePersistedQuery,
  storageKeyInstanceId,
  storageQueryKey,
  summarizeSavedData,
} from './persistence-model';

const instance = (id: string, ...rest: (string | null | string[])[]) => [
  'phoenix',
  'instance',
  id,
  ...rest,
];

describe('isPersistableQueryKey', () => {
  it('keeps Phoenix instance data', () => {
    expect(isPersistableQueryKey(instance('a', 'projects'))).toBe(true);
    expect(isPersistableQueryKey(instance('a', 'project', 'p', 'trace', 't'))).toBe(true);
    expect(
      isPersistableQueryKey(instance('a', 'project', 'p', 'trace-filter-vocabulary', 'day')),
    ).toBe(true);
    expect(isPersistableQueryKey(instance('a', 'project', 'p', 'sessions', 'list'))).toBe(true);
  });

  it('skips PXI chats, filter validation, other scopes, and placeholders', () => {
    expect(isPersistableQueryKey(instance('a', 'agent-sessions'))).toBe(false);
    expect(isPersistableQueryKey(instance('a', 'agent-session', 's'))).toBe(false);
    expect(
      isPersistableQueryKey(instance('a', 'project', 'p', 'trace-filter-validation', 'x > 1')),
    ).toBe(false);
    expect(isPersistableQueryKey(['pxi', 'models', 'a'])).toBe(false);
    expect(isPersistableQueryKey(['phoenix'])).toBe(false);
    expect(isPersistableQueryKey(instance('a'))).toBe(false);
    expect(isPersistableQueryKey(instance('missing', 'projects'))).toBe(false);
  });
});

describe('storage identity', () => {
  it('drops the moment a trace range was selected and keeps its preset', () => {
    const first = hashKey(
      instance('a', 'project', 'p', 'traces', 'recent', 'day:2026-10-30T09:41:00.000Z', null),
    );

    const later = hashKey(
      instance('a', 'project', 'p', 'traces', 'recent', 'day:2026-10-31T12:00:05.120Z', null),
    );

    expect(normalizeQueryHash(first)).toBe(normalizeQueryHash(later));
    expect(normalizeQueryHash(first)).toBe(
      hashKey(instance('a', 'project', 'p', 'traces', 'recent', 'day', null)),
    );
  });

  it('leaves other keys and non-range strings alone', () => {
    const hash = hashKey(instance('a', 'project', 'p', 'trace', 'day:not-a-time'));

    expect(normalizeQueryHash(hash)).toBe(hash);
    expect(normalizeQueryHash('not json')).toBe('not json');
  });

  it('maps persister keys and reads their instance back', () => {
    const hash = hashKey(instance('a"b', 'projects'));
    const key = offlineStorageKey(`${OfflineCachePrefix}-${hash}`);

    expect(key).toBe(`${OfflineCachePrefix}-${hash}`);
    expect(storageKeyInstanceId(key)).toBe('a"b');
    expect(storageKeyInstanceId('phoenix-instances')).toBeNull();
    expect(offlineStorageKey('other-key')).toBe('other-key');
  });
});

describe('persisted entries', () => {
  it('round-trip only what restoring needs', () => {
    const text = serializePersistedQuery({
      buster: OfflineCacheBuster,
      queryHash: '["phoenix","instance","a","projects"]',
      queryKey: instance('a', 'projects'),
      state: {
        data: { pages: [{ items: [1, 2] }], pageParams: [null] },
        dataUpdateCount: 4,
        dataUpdatedAt: 1_000,
        error: null,
        errorUpdateCount: 2,
        errorUpdatedAt: 900,
        fetchFailureCount: 0,
        fetchFailureReason: null,
        fetchMeta: null,
        isInvalidated: false,
        status: 'success',
        fetchStatus: 'fetching',
      },
    });

    expect(text).not.toContain('fetchStatus');

    const restored = deserializePersistedQuery(text);

    expect(restored.buster).toBe(OfflineCacheBuster);
    expect(restored.queryKey).toEqual(instance('a', 'projects'));
    expect(restored.state.data).toEqual({ pages: [{ items: [1, 2] }], pageParams: [null] });
    expect(restored.state.dataUpdatedAt).toBe(1_000);
    expect(restored.state.status).toBe('success');
  });

  it('rejects unreadable entries', () => {
    expect(() => deserializePersistedQuery('{')).toThrow('Unreadable offline entry.');
    expect(() => deserializePersistedQuery('{"buster":"x","queryHash":"h"}')).toThrow(
      'Unreadable offline entry.',
    );

    expect(() =>
      deserializePersistedQuery(
        '{"buster":"x","queryHash":"h","queryKey":[],"state":{"dataUpdatedAt":1}}',
      ),
    ).toThrow('Unreadable offline entry.');
  });
});

describe('offline index', () => {
  it('round-trips and ignores another schema', () => {
    const index = { k: { size: 10, writtenAt: 5 } };

    expect(parseOfflineIndex(serializeOfflineIndex(index))).toEqual(index);
    expect(
      parseOfflineIndex('{"buster":"schema-0","entries":{"k":{"size":1,"writtenAt":1}}}'),
    ).toEqual({});
    expect(parseOfflineIndex(null)).toEqual({});
  });

  it('sweeps unindexed and expired entries and forgets missing ones', () => {
    const now = OfflineCacheMaxAgeMs * 2;
    const fresh = `${OfflineCachePrefix}-fresh`;
    const stale = `${OfflineCachePrefix}-stale`;
    const orphan = `${OfflineCachePrefix}-orphan`;

    const plan = planOfflineSweep(
      ['phoenix-settings', fresh, stale, orphan],
      {
        [fresh]: { size: 1, writtenAt: now - 1_000 },
        [stale]: { size: 1, writtenAt: now - OfflineCacheMaxAgeMs - 1 },
        [`${OfflineCachePrefix}-gone`]: { size: 1, writtenAt: now },
      },
      now,
    );

    expect(plan.remove.sort()).toEqual([orphan, stale].sort());
    expect(Object.keys(plan.index)).toEqual([fresh]);
  });

  it('evicts the oldest entries until the budget fits, sparing the newest write', () => {
    const index = {
      a: { size: 40, writtenAt: 1 },
      b: { size: 40, writtenAt: 2 },
      c: { size: 40, writtenAt: 3 },
    };

    expect(planOfflineEviction(index, 200)).toEqual([]);
    expect(planOfflineEviction(index, 100)).toEqual(['a']);
    expect(planOfflineEviction(index, 50)).toEqual(['a', 'b']);
    expect(planOfflineEviction(index, 50, 'a')).toEqual(['b', 'c']);
  });
});

describe('recoveredInstanceIds', () => {
  it('reports servers that answer again while the device stays online', () => {
    expect(
      recoveredInstanceIds(
        { deviceOnline: true, instances: { a: { state: 'online' }, b: { state: 'online' } } },
        { deviceOnline: true, instances: { a: { state: 'offline' } } },
      ),
    ).toEqual(['a']);
  });

  it('leaves device reconnects to TanStack Query', () => {
    expect(
      recoveredInstanceIds(
        { deviceOnline: true, instances: { a: { state: 'online' } } },
        { deviceOnline: false, instances: { a: { state: 'offline' } } },
      ),
    ).toEqual([]);
  });
});

describe('summarizeSavedData', () => {
  const stored = (key: (string | null | string[])[]) =>
    storageQueryKey(`${OfflineCachePrefix}-${JSON.stringify(key)}`) ?? [];

  const none = { projectsList: false, projectIds: [], traceIds: [], sessionIds: [] };

  it('finds saved projects lists and project pages per instance', () => {
    expect(
      summarizeSavedData([
        stored(instance('a', 'projects')),
        stored(instance('a', 'project', 'p2', 'sessions', 'list')),
        stored(instance('a', 'project', 'p1', 'traces', 'recent', 'day', null)),
        stored(instance('b', 'version')),
      ]),
    ).toEqual({
      a: { ...none, projectsList: true, projectIds: ['p1', 'p2'] },
      b: none,
    });
  });

  it('finds saved trace and session details', () => {
    expect(
      summarizeSavedData([
        stored(instance('a', 'project', 'p1', 'trace', 't1')),
        stored(instance('a', 'project', 'p1', 'sessions', 'session', 's1')),
        stored(instance('a', 'project', 'p1', 'sessions', 'session', 's1', 'turns')),
      ]),
    ).toEqual({ a: { ...none, traceIds: ['t1'], sessionIds: ['s1'] } });
  });

  it('does not count a summary or review settings as an openable project', () => {
    expect(
      summarizeSavedData([
        stored(instance('a', 'project', 'p1', 'trace-summary', 'day', null)),
        stored(instance('a', 'project', 'p1', 'sessions', 'annotation-configs')),
      ]),
    ).toEqual({ a: none });
  });

  it('ignores storage keys that are not saved queries', () => {
    expect(storageQueryKey('phoenix-offline:index')).toBeNull();
    expect(storageQueryKey('instances-store')).toBeNull();
  });

  it('reads in-memory query keys too', () => {
    expect(summarizeSavedData([instance('a', 'project', 'p1', 'traces')])).toEqual({
      a: { ...none, projectIds: ['p1'] },
    });
  });
});
