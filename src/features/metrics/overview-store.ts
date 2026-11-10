import { create } from 'zustand';

import type { MetricsWindow } from './window';

type OverviewEntry = { window: MetricsWindow; selected: number | null };

type OverviewState = {
  entries: Record<string, OverviewEntry>;
  /** Starts a project's overview once; later calls keep what is there. */
  ensure: (key: string, window: MetricsWindow) => void;
  /** A new range clears the selection, whose bins belonged to the old one. */
  setWindow: (key: string, window: MetricsWindow) => void;
  select: (key: string, selected: number | null) => void;
};

/**
 * One project overview's range and selected bin, shared by every surface
 * that shows it. On the open iPhone Duo the figures and lists sit in the
 * sidebar and the charts in the detail column; selecting an hour in either
 * marks it in both. Nothing here is persisted: the range preset is a setting,
 * and the data is TanStack Query's.
 */
export const useOverviewStore = create<OverviewState>()((set) => ({
  entries: {},
  ensure: (key, window) =>
    set((state) =>
      state.entries[key]
        ? state
        : { entries: { ...state.entries, [key]: { window, selected: null } } },
    ),
  setWindow: (key, window) =>
    set((state) => ({ entries: { ...state.entries, [key]: { window, selected: null } } })),
  select: (key, selected) =>
    set((state) => {
      const entry = state.entries[key];

      return entry ? { entries: { ...state.entries, [key]: { ...entry, selected } } } : state;
    }),
}));

export function overviewKey(instanceId: string, projectId: string) {
  return `${instanceId}:${projectId}`;
}
