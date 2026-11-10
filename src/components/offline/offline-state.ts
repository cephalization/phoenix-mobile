import { onlineManager, type QueryObserverBaseResult } from '@tanstack/react-query';

import { causedByNetworkFailure } from '@/features/offline/reachability';
import { formatRelativeTime } from '@/lib/format';

const RelativeAgeLimitMs = 7 * 24 * 60 * 60_000;

/** `Offline · Saved 2h ago`, or just `Offline` when nothing is shown. Short enough for a sidebar. */
export function cachedNoticeText(dataUpdatedAt: number | undefined, now: number): string {
  if (!dataUpdatedAt) return 'Offline';

  const age = formatRelativeTime(dataUpdatedAt, now);

  if (age === 'now') return 'Offline · Saved just now';

  // Past a week the formatter gives a date, which reads without "ago".
  return now - dataUpdatedAt < RelativeAgeLimitMs
    ? `Offline · Saved ${age} ago`
    : `Offline · Saved ${age}`;
}

/** `3 waiting`, or null when nothing is queued; the notice reads "Offline · Saved 2h ago · 3 waiting". */
export function pendingChangesText(count: number): string | null {
  if (count <= 0) return null;

  return `${count} waiting`;
}

/**
 * A screen's query has nothing to show because its server can't be reached:
 * it is paused for want of a network, or it failed to connect, and no copy
 * was loaded or saved. Any other error is the server's answer and keeps its
 * own error state.
 */
export function isUnavailableOffline(
  query: Pick<QueryObserverBaseResult, 'data' | 'error' | 'fetchStatus'>,
  offline: boolean,
): boolean {
  if (query.data !== undefined) return false;

  if (query.fetchStatus === 'paused') return true;

  return query.error !== null && (offline || causedByNetworkFailure(query.error));
}

/**
 * True while the device has no network. A refetch then pauses until one
 * returns, so pull to refresh should end at once rather than wait on it.
 */
export function isDeviceOffline(): boolean {
  return !onlineManager.isOnline();
}

/**
 * How an unreachable instance reads in a list of instances: what can still be
 * opened. `Offline · 3 projects saved`, `Offline · Projects saved` when only
 * the list is, or `Offline · Nothing saved`.
 */
export function offlineInstanceText(saved: {
  projectsList: boolean;
  projectIds: readonly string[];
}): string {
  const count = saved.projectIds.length;

  if (count > 0) return `Offline · ${count} ${count === 1 ? 'project' : 'projects'} saved`;

  return saved.projectsList ? 'Offline · Projects saved' : 'Offline · Nothing saved';
}

/** Whether an instance has anything at all to show while it can't be reached. */
export function hasSavedData(saved: {
  projectsList: boolean;
  projectIds: readonly string[];
}): boolean {
  return saved.projectsList || saved.projectIds.length > 0;
}
