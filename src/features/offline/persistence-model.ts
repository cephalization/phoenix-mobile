import type { PersistedQuery } from '@tanstack/query-persist-client-core';
import type { QueryKey } from '@tanstack/react-query';

import {
  isJsonArray,
  isJsonNumber,
  isJsonObject,
  isJsonString,
  type JsonValue,
  parseJsonValue,
} from '@/lib/json';

/**
 * Bump when the shape of any persisted Phoenix query result changes, so an
 * update discards entries the new code cannot read.
 */
export const OfflineCacheSchemaVersion = 1;

export const OfflineCacheBuster = `schema-${OfflineCacheSchemaVersion}`;

export const OfflineCacheMaxAgeMs = 14 * 24 * 60 * 60_000;

/** Storage keys are `${OfflineCachePrefix}-${normalized query hash}`. */
export const OfflineCachePrefix = 'phoenix-offline';

/** Size and age of every persisted entry; kept beside the entries themselves. */
export const OfflineCacheIndexKey = 'phoenix-offline:index';

/**
 * Phoenix keys that hold something other than viewable Phoenix data: PXI chats
 * are server-side agent sessions whose transcripts must not be stored locally,
 * and filter validation answers a draft expression as the user types.
 */
const ExcludedSegments: ReadonlySet<string> = new Set([
  'agent-session',
  'agent-sessions',
  'trace-filter-validation',
]);

/** `day:2026-10-31T09:41:00.000Z`, the identity `createTraceRange` gives each range selection. */
const RangeSelectionKey = /^(hour|day|week|month):\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

/** Whether a query holds Phoenix data worth keeping for offline use. */
export function isPersistableQueryKey(queryKey: QueryKey): boolean {
  const [scope, kind, instanceId] = queryKey;

  if (scope !== 'phoenix' || kind !== 'instance' || !isJsonString(instanceId)) return false;

  if (instanceId === 'missing' || queryKey.length < 4) return false;

  return !queryKey.some((segment) => isJsonString(segment) && ExcludedSegments.has(segment));
}

/**
 * The storage identity of a query hash. A trace range selection is keyed by
 * the moment it was made, so every visit to a project creates a new key; the
 * stored copy drops that moment and keeps the preset, so a later visit (or a
 * relaunch while offline) finds the last list loaded for the same view.
 */
export function normalizeQueryHash(queryHash: string): string {
  const parsed = parseJsonValue(queryHash);

  if (!isJsonArray(parsed)) return queryHash;

  return JSON.stringify(parsed.map(normalizeSegment));
}

function normalizeSegment(segment: JsonValue): JsonValue {
  if (!isJsonString(segment)) return segment;

  const match = RangeSelectionKey.exec(segment);

  return match ? match[1] : segment;
}

/** Maps the persister's `${prefix}-${queryHash}` key onto its stored identity. */
export function offlineStorageKey(persisterKey: string): string {
  const head = `${OfflineCachePrefix}-`;

  if (!persisterKey.startsWith(head)) return persisterKey;

  return head + normalizeQueryHash(persisterKey.slice(head.length));
}

export function isOfflineStorageKey(key: string): boolean {
  return key.startsWith(`${OfflineCachePrefix}-`);
}

/** The instance a stored entry belongs to, read from its key. */
export function storageKeyInstanceId(key: string): string | null {
  const parsed = storageQueryKey(key);

  if (!parsed) return null;

  const [scope, kind, instanceId] = parsed;

  return scope === 'phoenix' && kind === 'instance' && isJsonString(instanceId) ? instanceId : null;
}

/**
 * What is saved for one instance: whether its projects list is, which
 * projects' lists are, and which traces and sessions can open on their own.
 * Trace and session IDs are unique within an instance.
 */
export type SavedInstanceData = {
  projectsList: boolean;
  projectIds: string[];
  traceIds: string[];
  sessionIds: string[];
};

type SavedSets = {
  projectsList: boolean;
  projectIds: Set<string>;
  traceIds: Set<string>;
  sessionIds: Set<string>;
};

/**
 * Reads, from query keys alone, what each instance has saved. A project
 * counts once its overview, traces list, or sessions list is kept, a trace once its
 * detail is, and a session once its detail is. Takes stored entries (through
 * `storageQueryKey`) and in-memory queries alike.
 */
export function summarizeSavedData(keys: Iterable<QueryKey>): Record<string, SavedInstanceData> {
  const saved: Record<string, SavedSets> = {};

  for (const [scope, kind, instanceId, section, projectId, area, part, id] of keys) {
    if (scope !== 'phoenix' || kind !== 'instance' || !isJsonString(instanceId)) continue;

    const entry = (saved[instanceId] ??= {
      projectsList: false,
      projectIds: new Set(),
      traceIds: new Set(),
      sessionIds: new Set(),
    });

    if (section === 'projects') entry.projectsList = true;

    if (section !== 'project' || !isJsonString(projectId)) continue;

    // Keys: `overview/…`, `traces/…`, and `sessions/list` are the project's
    // views; `trace/<id>` and `sessions/session/<id>` are details.
    if (area === 'overview' || area === 'traces' || (area === 'sessions' && part === 'list')) {
      entry.projectIds.add(projectId);
    }

    if (area === 'trace' && isJsonString(part)) entry.traceIds.add(part);

    if (area === 'sessions' && part === 'session' && isJsonString(id)) entry.sessionIds.add(id);
  }

  return Object.fromEntries(
    Object.entries(saved).map(([instanceId, entry]) => [
      instanceId,
      {
        projectsList: entry.projectsList,
        projectIds: [...entry.projectIds].sort(),
        traceIds: [...entry.traceIds].sort(),
        sessionIds: [...entry.sessionIds].sort(),
      },
    ]),
  );
}

/** The query key a stored entry was saved under, or null for other storage keys. */
export function storageQueryKey(key: string): JsonValue[] | null {
  if (!isOfflineStorageKey(key)) return null;

  const parsed = parseJsonValue(key.slice(OfflineCachePrefix.length + 1));

  return isJsonArray(parsed) ? parsed : null;
}

/** Only what restoring needs: the data, when it was fetched, and how to find it. */
export function serializePersistedQuery(persisted: PersistedQuery): string {
  return JSON.stringify({
    buster: persisted.buster,
    queryHash: persisted.queryHash,
    queryKey: persisted.queryKey,
    state: { data: persisted.state.data, dataUpdatedAt: persisted.state.dataUpdatedAt },
  });
}

/** Rebuilds a stored entry; throws on anything unreadable so the persister drops it. */
export function deserializePersistedQuery(text: string): PersistedQuery {
  const parsed = parseJsonValue(text);

  if (!isJsonObject(parsed)) throw new Error('Unreadable offline entry.');

  const { buster, queryHash, queryKey, state } = parsed;

  if (!isJsonString(buster) || !isJsonString(queryHash) || !isJsonArray(queryKey)) {
    throw new Error('Unreadable offline entry.');
  }

  if (!isJsonObject(state) || !isJsonNumber(state.dataUpdatedAt) || state.data === undefined) {
    throw new Error('Unreadable offline entry.');
  }

  return {
    buster,
    queryHash,
    queryKey,
    state: {
      data: state.data,
      dataUpdateCount: 1,
      dataUpdatedAt: state.dataUpdatedAt,
      error: null,
      errorUpdateCount: 0,
      errorUpdatedAt: 0,
      fetchFailureCount: 0,
      fetchFailureReason: null,
      fetchMeta: null,
      isInvalidated: false,
      status: 'success',
      fetchStatus: 'idle',
    },
  };
}

export type OfflineIndexEntry = {
  /** Stored length in UTF-16 code units, which is what the platform limits count. */
  size: number;
  /** When the entry was last written; the oldest go first when over budget. */
  writtenAt: number;
};

export type OfflineIndex = Record<string, OfflineIndexEntry>;

/** The persisted index, or an empty one when it is missing, unreadable, or from another schema. */
export function parseOfflineIndex(text: string | null) {
  const parsed = text === null ? null : parseJsonValue(text);

  const index: OfflineIndex = {};

  if (!isJsonObject(parsed) || parsed.buster !== OfflineCacheBuster) return index;

  const entries = parsed.entries;

  if (!isJsonObject(entries)) return index;

  for (const [key, entry] of Object.entries(entries)) {
    if (isJsonObject(entry) && isJsonNumber(entry.size) && isJsonNumber(entry.writtenAt)) {
      index[key] = { size: entry.size, writtenAt: entry.writtenAt };
    }
  }

  return index;
}

export function serializeOfflineIndex(index: OfflineIndex): string {
  return JSON.stringify({ buster: OfflineCacheBuster, entries: index });
}

export type OfflineSweep = { remove: string[]; index: OfflineIndex };

/**
 * The launch-time cleanup: entries the index does not know (written by a
 * session that ended before saving its index, or by an older schema) and
 * entries older than the maximum age are removed; index rows whose entry is
 * gone are dropped.
 */
export function planOfflineSweep(
  storedKeys: readonly string[],
  index: OfflineIndex,
  now: number,
): OfflineSweep {
  const stored = new Set(storedKeys.filter(isOfflineStorageKey));
  const remove: string[] = [];
  const kept: OfflineIndex = {};

  for (const key of stored) {
    const entry = index[key];

    if (!entry || now - entry.writtenAt > OfflineCacheMaxAgeMs) remove.push(key);
    else kept[key] = entry;
  }

  return { remove, index: kept };
}

/** Oldest-first keys to delete so the index fits `budget`, never `protect`. */
export function planOfflineEviction(
  index: OfflineIndex,
  budget: number,
  protect?: string,
): string[] {
  let total = Object.values(index).reduce((sum, entry) => sum + entry.size, 0);

  if (total <= budget) return [];

  const oldestFirst = Object.entries(index)
    .filter(([key]) => key !== protect)
    .sort(([, a], [, b]) => a.writtenAt - b.writtenAt);

  const evicted: string[] = [];

  for (const [key, entry] of oldestFirst) {
    if (total <= budget) break;
    evicted.push(key);
    total -= entry.size;
  }

  return evicted;
}

type ReachabilitySnapshot = {
  deviceOnline: boolean;
  instances: Record<string, { state: string }>;
};

/**
 * Instances whose server answered again after failing while the device stayed
 * online. A device reconnect is left to TanStack Query's own refetch, and an
 * instance's first answer after launch is not a recovery.
 */
export function recoveredInstanceIds(
  state: ReachabilitySnapshot,
  previous: ReachabilitySnapshot,
): string[] {
  if (!state.deviceOnline || !previous.deviceOnline) return [];

  return Object.entries(state.instances)
    .filter(
      ([id, entry]) => entry.state === 'online' && previous.instances[id]?.state === 'offline',
    )
    .map(([id]) => id);
}
