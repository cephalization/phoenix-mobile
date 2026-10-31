import { createContext, use } from 'react';
import { create } from 'zustand';

import type { JsonObject } from '@/lib/json';

/**
 * What the native split shows in its detail column, for list screens in the
 * sidebar to mark the selected row. `active` is false outside native columns,
 * where list screens keep their own selection.
 */
export type SplitDetail = {
  active: boolean;
  route: { name: string; params: JsonObject } | null;
};

export const SplitDetailContext = createContext<SplitDetail>({ active: false, route: null });

export function useSplitDetail() {
  return use(SplitDetailContext);
}

/** Whether the detail column shows `routeName` with `param` equal to `value`. */
export function isSplitDetail(
  detail: SplitDetail,
  routeName: string,
  param: string,
  value: string,
): boolean {
  return detail.route?.name === routeName && detail.route.params[param] === value;
}

/**
 * The order of the session queue the sidebar shows, so a session page in the
 * detail column can move to the next session after a review, as the list's
 * own detail pane did before the split moved to native columns.
 */
type SessionQueueOrder = {
  projectId: string | null;
  sessionIds: readonly string[];
  publish: (projectId: string, sessionIds: readonly string[]) => void;
};

export const useSessionQueueOrder = create<SessionQueueOrder>()((set) => ({
  projectId: null,
  sessionIds: [],
  publish: (projectId, sessionIds) =>
    set((state) =>
      state.projectId === projectId &&
      state.sessionIds.length === sessionIds.length &&
      state.sessionIds.every((id, index) => id === sessionIds[index])
        ? state
        : { projectId, sessionIds },
    ),
}));
