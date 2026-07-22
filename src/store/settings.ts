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
  setAppearance: (appearance: Appearance) => void;
  setTraceRangePreset: (traceRangePreset: TraceRangePreset) => void;
  setTraceStreaming: (traceStreaming: boolean) => void;
};

const serverStorage: StateStorage = {
  getItem: () => null,
  removeItem: () => undefined,
  setItem: () => undefined,
};

const storage = createJSONStorage(() =>
  Platform.OS === 'web' && typeof window === 'undefined' ? serverStorage : AsyncStorage
);

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      appearance: 'system',
      traceRangePreset: 'day',
      traceStreaming: false,
      setAppearance: (appearance) => set({ appearance }),
      setTraceRangePreset: (traceRangePreset) => set({ traceRangePreset }),
      setTraceStreaming: (traceStreaming) => set({ traceStreaming }),
    }),
    { name: 'phoenix-settings', storage }
  )
);
