import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import { Platform } from 'react-native';
import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';

export type SessionReviewQueueSettings = {
  completionPolicy: 'any-human';
  requiredConfigNames: string[];
};

export const defaultSessionReviewQueueSettings: SessionReviewQueueSettings = {
  completionPolicy: 'any-human',
  requiredConfigNames: [],
};

type SessionReviewSettingsState = {
  anonymousReviewerIds: Record<string, string>;
  hasHydrated: boolean;
  queues: Record<string, SessionReviewQueueSettings>;
  clearAllSettings: () => void;
  clearInstanceSettings: (instanceIds: readonly string[]) => void;
  clearQueueSettings: (instanceId: string, projectId: string) => void;
  setRequiredConfigNames: (
    instanceId: string,
    projectId: string,
    requiredConfigNames: readonly string[]
  ) => void;
  ensureAnonymousReviewerId: (instanceId: string) => void;
  setHasHydrated: (hasHydrated: boolean) => void;
};

const serverStorage: StateStorage = {
  getItem: () => null,
  removeItem: () => undefined,
  setItem: () => undefined,
};

const storage = createJSONStorage(() =>
  Platform.OS === 'web' && typeof window === 'undefined' ? serverStorage : AsyncStorage
);

export function sessionReviewQueueKey(instanceId: string, projectId: string): string {
  return JSON.stringify([instanceId, projectId]);
}

export function getSessionReviewQueueSettings(
  queues: Record<string, SessionReviewQueueSettings>,
  instanceId: string,
  projectId: string
): SessionReviewQueueSettings {
  return queues[sessionReviewQueueKey(instanceId, projectId)] ?? defaultSessionReviewQueueSettings;
}

export const useSessionReviewSettingsStore = create<SessionReviewSettingsState>()(
  persist(
    (set) => ({
      anonymousReviewerIds: {},
      hasHydrated: false,
      queues: {},
      ensureAnonymousReviewerId: (instanceId) => {
        const reviewerId = Crypto.randomUUID();
        set((state) => ({
          anonymousReviewerIds: state.anonymousReviewerIds[instanceId]
            ? state.anonymousReviewerIds
            : { ...state.anonymousReviewerIds, [instanceId]: reviewerId },
        }));
      },
      clearQueueSettings: (instanceId, projectId) =>
        set((state) => {
          const key = sessionReviewQueueKey(instanceId, projectId);
          const { [key]: _removed, ...queues } = state.queues;
          return { queues };
        }),
      clearAllSettings: () => set({ anonymousReviewerIds: {}, queues: {} }),
      clearInstanceSettings: (instanceIds) =>
        set((state) => {
          const removedIds = new Set(instanceIds);
          if (removedIds.size === 0) return state;
          return {
            anonymousReviewerIds: Object.fromEntries(
              Object.entries(state.anonymousReviewerIds).filter(([instanceId]) => !removedIds.has(instanceId))
            ),
            queues: Object.fromEntries(
              Object.entries(state.queues).filter(([key]) => {
                try {
                  const value: unknown = JSON.parse(key);
                  return !Array.isArray(value) || typeof value[0] !== 'string' || !removedIds.has(value[0]);
                } catch {
                  return true;
                }
              })
            ),
          };
        }),
      setRequiredConfigNames: (instanceId, projectId, requiredConfigNames) =>
        set((state) => ({
          queues: {
            ...state.queues,
            [sessionReviewQueueKey(instanceId, projectId)]: {
              completionPolicy: 'any-human',
              requiredConfigNames: [
                ...new Set(requiredConfigNames.map((name) => name.trim()).filter(Boolean)),
              ],
            },
          },
        })),
      setHasHydrated: (hasHydrated) => set({ hasHydrated }),
    }),
    {
      name: 'phoenix-session-review-settings',
      storage,
      partialize: (state) => ({
        anonymousReviewerIds: state.anonymousReviewerIds,
        queues: state.queues,
      }),
      onRehydrateStorage: (initialState) => (restoredState) => {
        (restoredState ?? initialState).setHasHydrated(true);
      },
    }
  )
);
