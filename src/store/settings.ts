import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';

export type Appearance = 'system' | 'light' | 'dark';

export type TraceRangePreset = 'hour' | 'day' | 'week' | 'month';

type SettingsState = {
  appearance: Appearance;
  traceRangePreset: TraceRangePreset;
  traceStreaming: boolean;
  /** Project IDs per instance, most recently opened first. */
  recentProjects: Record<string, string[]>;
  noteProjectOpened: (instanceId: string, projectId: string) => void;
  setAppearance: (appearance: Appearance) => void;
  setTraceRangePreset: (traceRangePreset: TraceRangePreset) => void;
  setTraceStreaming: (traceStreaming: boolean) => void;
};

const RecentProjectLimit = 4;

const serverStorage: StateStorage = {
  getItem: () => null,
  removeItem: () => undefined,
  setItem: () => undefined,
};

const storage = createJSONStorage(() =>
  Platform.OS === 'web' && typeof window === 'undefined' ? serverStorage : AsyncStorage,
);

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      appearance: 'system',
      traceRangePreset: 'day',
      traceStreaming: false,
      recentProjects: {},
      noteProjectOpened: (instanceId, projectId) =>
        set((state) => {
          const current = state.recentProjects[instanceId] ?? [];

          if (current[0] === projectId) return state;

          return {
            recentProjects: {
              ...state.recentProjects,
              [instanceId]: [projectId, ...current.filter((id) => id !== projectId)].slice(
                0,
                RecentProjectLimit,
              ),
            },
          };
        }),
      setAppearance: (appearance) => set({ appearance }),
      setTraceRangePreset: (traceRangePreset) => set({ traceRangePreset }),
      setTraceStreaming: (traceStreaming) => set({ traceStreaming }),
    }),
    { name: 'phoenix-settings', storage },
  ),
);
