import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { normalizeTraceFilter, rememberTraceFilter } from '@/features/traces/filter';

type TraceFilterState = {
  /**
   * The filter each project's Traces list applies, keyed by `traceFilterKey`.
   * Screen state shared with the filter sheet; it is not persisted, so a
   * relaunch starts unfiltered.
   */
  active: Record<string, string>;
  /** Recently applied expressions per project, newest first. Persisted. */
  recent: Record<string, string[]>;
  applyFilter: (key: string, expression: string) => void;
  clearFilter: (key: string) => void;
  forgetRecent: (key: string, expression: string) => void;
};

const storage = createJSONStorage(() => AsyncStorage);

/** One project's slot: filters are written against that project's spans and annotations. */
export function traceFilterKey(instanceId: string, projectId: string) {
  return JSON.stringify([instanceId, projectId]);
}

export const useTraceFilterStore = create<TraceFilterState>()(
  persist(
    (set) => ({
      active: {},
      recent: {},
      applyFilter: (key, expression) =>
        set((state) => {
          const normalized = normalizeTraceFilter(expression);

          if (normalized.length === 0) {
            const { [key]: _cleared, ...active } = state.active;

            return { active };
          }

          return {
            active: { ...state.active, [key]: normalized },
            recent: {
              ...state.recent,
              [key]: rememberTraceFilter(state.recent[key] ?? [], normalized),
            },
          };
        }),
      clearFilter: (key) =>
        set((state) => {
          const { [key]: _cleared, ...active } = state.active;

          return { active };
        }),
      forgetRecent: (key, expression) =>
        set((state) => ({
          recent: {
            ...state.recent,
            [key]: (state.recent[key] ?? []).filter((item) => item !== expression),
          },
        })),
    }),
    {
      name: 'phoenix-trace-filters',
      storage,
      partialize: (state) => ({ recent: state.recent }),
    },
  ),
);
