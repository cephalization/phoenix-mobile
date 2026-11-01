import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  experimental_createQueryPersister,
  type AsyncStorage as PersisterStorage,
} from '@tanstack/query-persist-client-core';
import type { Query, QueryClient, QueryKey } from '@tanstack/react-query';
import { AppState, Platform } from 'react-native';
import { create } from 'zustand';

import { isJsonString } from '@/lib/json';
import { useSettingsStore } from '@/store/settings';

import {
  deserializePersistedQuery,
  isOfflineStorageKey,
  isPersistableQueryKey,
  type OfflineIndex,
  OfflineCacheBuster,
  OfflineCacheIndexKey,
  OfflineCacheMaxAgeMs,
  OfflineCachePrefix,
  offlineStorageKey,
  parseOfflineIndex,
  planOfflineEviction,
  planOfflineSweep,
  recoveredInstanceIds,
  type SavedInstanceData,
  serializeOfflineIndex,
  serializePersistedQuery,
  storageKeyInstanceId,
  storageQueryKey,
  summarizeSavedData,
} from './persistence-model';
import { useReachabilityStore } from './reachability';

/**
 * Offline copies of Phoenix data. Each successful Phoenix query is written to
 * AsyncStorage as it loads (TanStack Query's per-query persister) and read back
 * when a screen asks for data it does not hold in memory, so a relaunch away
 * from the server still shows what was last seen. PXI chats and filter
 * validation are never written (`isPersistableQueryKey`).
 *
 * AsyncStorage is shared with the app's own stores and is small on Android
 * (6 MB) and on web (localStorage), so the cache keeps a size index and drops
 * its oldest entries past a per-platform budget.
 */

/** Total stored characters the cache may use. */
const OfflineBudget = Platform.select({ android: 3_000_000, web: 2_000_000, default: 12_000_000 });

/** A single page larger than this is not worth crowding out everything else for. */
const MaxEntrySize = Math.floor(OfflineBudget / 4);

const IndexSaveDelayMs = 1_000;

// Static web rendering runs in Node, where there is no storage to read.
const serverRendering = Platform.OS === 'web' && typeof window === 'undefined';

const index = new Map<string, OfflineIndex[string]>();
const forgottenInstances = new Set<string>();
let indexLoaded: Promise<void> | null = null;
let indexSaveTimer: ReturnType<typeof setTimeout> | null = null;
let attachedClient: QueryClient | null = null;

const SavedSummaryDelayMs = 300;
let savedSummaryTimer: ReturnType<typeof setTimeout> | null = null;

/** An instance with nothing saved. */
export const NothingSavedOffline: SavedInstanceData = {
  projectsList: false,
  projectIds: [],
  traceIds: [],
  sessionIds: [],
};

/**
 * What can be shown for each instance without its server: saved to storage,
 * or loaded this session. Lets lists mark the projects and instances that
 * would open empty while offline.
 */
const useSavedDataStore = create<{ saved: Record<string, SavedInstanceData> }>()(() => ({
  saved: {},
}));

/** What an instance has saved; the same object until it changes. */
export function useSavedOfflineData(instanceId: string): SavedInstanceData {
  return useSavedDataStore((state) => state.saved[instanceId] ?? NothingSavedOffline);
}

/** Every instance's saved data, for lists of instances. */
export function useSavedOfflineDataByInstance(): Record<string, SavedInstanceData> {
  return useSavedDataStore((state) => state.saved);
}

function scheduleSavedSummary() {
  if (savedSummaryTimer !== null) return;

  savedSummaryTimer = setTimeout(() => {
    savedSummaryTimer = null;

    const inMemory = (attachedClient?.getQueryCache().getAll() ?? [])
      .filter((query) => query.state.data !== undefined)
      .map((query) => query.queryKey);

    const stored = [...index.keys()].flatMap((key) => {
      const queryKey = storageQueryKey(key);

      return queryKey ? [queryKey] : [];
    });

    useSavedDataStore.setState({ saved: summarizeSavedData([...stored, ...inMemory]) });
  }, SavedSummaryDelayMs);
}

function cacheEnabled() {
  return useSettingsStore.getState().offlineCacheEnabled;
}

/** Whether a query's data is saved for, and restored from, offline storage. */
export function shouldPersistQuery(query: Query): boolean {
  if (!cacheEnabled() || !isPersistableQueryKey(query.queryKey)) return false;

  const instanceId = query.queryKey[2];

  return !(isJsonString(instanceId) && forgottenInstances.has(instanceId));
}

const offlineStorage: PersisterStorage = {
  getItem: (key) => AsyncStorage.getItem(offlineStorageKey(key)),
  setItem: (key, value) => writeEntry(offlineStorageKey(key), value),
  removeItem: (key) => removeEntries([offlineStorageKey(key)]),
};

const persister = experimental_createQueryPersister({
  storage: serverRendering ? undefined : offlineStorage,
  buster: OfflineCacheBuster,
  maxAge: OfflineCacheMaxAgeMs,
  prefix: OfflineCachePrefix,
  serialize: serializePersistedQuery,
  deserialize: deserializePersistedQuery,
  filters: { predicate: shouldPersistQuery },
  // The persister's own refetch-on-restore calls `query.fetch()` without
  // handling its failure, so an unreachable server surfaced as an unhandled
  // rejection. The wrapper below refetches stale restored data itself.
  refetchOnRestore: false,
});

/**
 * The QueryClient's default `persister`. A query restored from storage shows
 * the saved data at once; when that data is stale it is refetched in the
 * background, and a failure (the server is away) just leaves the saved copy.
 */
export const offlineQueryPersister: typeof persister.persisterFn = async (
  queryFn,
  context,
  query,
) => {
  const updatedAt = query.state.dataUpdatedAt;
  const result = await persister.persisterFn(queryFn, context, query);
  // A restore copies the saved timestamp onto the query before returning; a
  // fetch from the server only sets it once this function resolves.
  const restored = query.state.data === undefined && query.state.dataUpdatedAt !== updatedAt;

  if (restored) {
    // Runs after this fetch settles, so it starts a real refetch rather than joining this one.
    setTimeout(() => {
      if (query.isStale()) query.fetch().catch(() => undefined);
    }, 0);
  }

  return result;
};

/**
 * Saves a query's current data now. The persister writes only after a fetch,
 * so an optimistic `setQueryData` (a change waiting in the outbox) would
 * otherwise be missing from the offline copy after a relaunch.
 */
export async function persistQueryNow(queryKey: QueryKey): Promise<void> {
  const query = attachedClient?.getQueryCache().find({ exact: true, queryKey });

  if (query && query.state.data !== undefined && shouldPersistQuery(query)) {
    await persister.persistQuery(query);
  }
}

async function writeEntry(key: string, value: string) {
  const instanceId = storageKeyInstanceId(key);

  if (!cacheEnabled() || (instanceId !== null && forgottenInstances.has(instanceId))) return;

  if (value.length > MaxEntrySize) {
    // A stale smaller copy would outlive the page it describes.
    await removeEntries([key]);

    return;
  }

  // Indexed before the write lands, so a concurrent sweep keeps it.
  index.set(key, { size: value.length, writtenAt: Date.now() });

  try {
    await AsyncStorage.setItem(key, value);
  } catch {
    // Storage is full or unavailable; the page simply isn't kept offline.
    index.delete(key);
  }

  await removeEntries(planOfflineEviction(Object.fromEntries(index), OfflineBudget, key));
  scheduleIndexSave();
}

async function removeEntries(keys: readonly string[]) {
  if (keys.length === 0 || serverRendering) return;

  for (const key of keys) index.delete(key);

  try {
    await AsyncStorage.multiRemove(keys);
  } catch {
    // The next launch's sweep removes whatever is left unindexed.
  }

  scheduleIndexSave();
}

function scheduleIndexSave() {
  scheduleSavedSummary();

  if (indexSaveTimer !== null) return;

  indexSaveTimer = setTimeout(() => {
    indexSaveTimer = null;
    void saveIndex();
  }, IndexSaveDelayMs);
}

async function saveIndex() {
  try {
    await AsyncStorage.setItem(
      OfflineCacheIndexKey,
      serializeOfflineIndex(Object.fromEntries(index)),
    );
  } catch {
    // Unsaved rows only cost their entries at the next sweep.
  }
}

/** Loads the index and removes expired, unindexed, and over-budget entries, once per launch. */
function loadIndex(): Promise<void> {
  indexLoaded ??= (async () => {
    try {
      const [savedIndex, keys] = await Promise.all([
        AsyncStorage.getItem(OfflineCacheIndexKey),
        AsyncStorage.getAllKeys(),
      ]);

      // Entries written since launch are already indexed and count as known.
      const known: OfflineIndex = {
        ...parseOfflineIndex(savedIndex),
        ...Object.fromEntries(index),
      };

      const sweep = planOfflineSweep(keys, known, Date.now());

      for (const [key, entry] of Object.entries(sweep.index)) {
        if (!index.has(key)) index.set(key, entry);
      }

      await removeEntries(sweep.remove);
      await removeEntries(planOfflineEviction(Object.fromEntries(index), OfflineBudget));
      await saveIndex();
      scheduleSavedSummary();
    } catch {
      // A failed sweep leaves the cache as it was; reads still check age.
    }
  })();

  return indexLoaded;
}

/**
 * Removes offline copies of one instance's data, or of every instance. For a
 * removed instance its queries leave memory too and its reachability is
 * forgotten; clearing everything (Settings) resets the in-memory Phoenix
 * queries instead, so open screens reload from the server or say they are
 * not available offline.
 */
export async function clearOfflineData(instanceId?: string): Promise<void> {
  if (instanceId !== undefined) {
    forgottenInstances.add(instanceId);
    useReachabilityStore.getState().forget(instanceId);
    attachedClient?.removeQueries({ queryKey: ['phoenix', 'instance', instanceId] });
  }

  if (!serverRendering) {
    await loadIndex();

    let keys: readonly string[];

    try {
      keys = await AsyncStorage.getAllKeys();
    } catch {
      // Unreadable storage: what is indexed can still go.
      keys = [...index.keys()];
    }

    await removeEntries(
      keys.filter(
        (key) =>
          isOfflineStorageKey(key) &&
          (instanceId === undefined || storageKeyInstanceId(key) === instanceId),
      ),
    );
    await saveIndex();
  }

  // After storage is empty, so a refetch cannot restore what was just removed.
  // Not awaited: offline, the refetches pause until a network returns.
  if (instanceId === undefined) void attachedClient?.resetQueries({ queryKey: ['phoenix'] });
}

/**
 * Connects the cache to the app's QueryClient: sweeps storage, restores
 * queries that pause for want of a network (the persister only runs when a
 * fetch starts, which a paused query never does), and refetches an
 * instance's queries when its server answers again. Returns a cleanup.
 */
export function attachOfflineCache(client: QueryClient): () => void {
  attachedClient = client;

  const restoring = new Set<string>();
  // Soon after launch, so offline marks are on the first lists shown.
  const sweep = setTimeout(() => void loadIndex(), 300);

  const offCache = client.getQueryCache().subscribe((event) => {
    if (event.type === 'removed') scheduleSavedSummary();

    if (event.type !== 'updated') return;

    const { query } = event;

    if (event.action.type === 'success') scheduleSavedSummary();

    if (query.state.fetchStatus !== 'paused' || query.state.data !== undefined) return;

    if (restoring.has(query.queryHash) || !shouldPersistQuery(query)) return;

    restoring.add(query.queryHash);

    void persister
      .retrieveQuery(query.queryHash, (persisted) => {
        if (query.state.data !== undefined) return;
        client.setQueryData(query.queryKey, persisted.state.data, {
          updatedAt: persisted.state.dataUpdatedAt,
        });
      })
      .finally(() => restoring.delete(query.queryHash));
  });

  const offReachability = useReachabilityStore.subscribe((state, previous) => {
    for (const instanceId of recoveredInstanceIds(state, previous)) {
      void client.invalidateQueries(
        { queryKey: ['phoenix', 'instance', instanceId] },
        { cancelRefetch: false },
      );
    }
  });

  const offAppState = AppState.addEventListener('change', (state) => {
    if (state !== 'active' && indexSaveTimer !== null) {
      clearTimeout(indexSaveTimer);
      indexSaveTimer = null;
      void saveIndex();
    }
  });

  return () => {
    clearTimeout(sweep);

    if (savedSummaryTimer !== null) clearTimeout(savedSummaryTimer);
    savedSummaryTimer = null;
    offCache();
    offReachability();
    offAppState.remove();

    if (attachedClient === client) attachedClient = null;
  };
}
