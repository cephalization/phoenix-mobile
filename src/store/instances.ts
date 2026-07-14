import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';

import type { PhoenixInstance } from '@/types/instance';
import type { ModelSelection } from '@/features/pxi/types';
import { clearPxiSessions, deletePxiSessionsForInstance } from '@/lib/pxi-session-db';

type InstanceState = {
  instances: PhoenixInstance[];
  activeInstanceId: string | null;
  pxiModels: Record<string, ModelSelection>;
  hasHydrated: boolean;
  addInstance: (instance: PhoenixInstance) => void;
  clearInstances: () => Promise<void>;
  removeInstance: (id: string) => Promise<void>;
  setActiveInstanceId: (id: string | null) => void;
  setHasHydrated: (hasHydrated: boolean) => void;
  setPxiModel: (instanceId: string, model: ModelSelection) => void;
};

const serverStorage: StateStorage = {
  getItem: () => null,
  removeItem: () => undefined,
  setItem: () => undefined,
};

const storage = createJSONStorage(() =>
  Platform.OS === 'web' && typeof window === 'undefined' ? serverStorage : AsyncStorage
);

export const useInstanceStore = create<InstanceState>()(
  persist(
    (set) => ({
      instances: [],
      activeInstanceId: null,
      pxiModels: {},
      hasHydrated: false,
      addInstance: (instance) =>
        set((state) => ({
          instances: [...state.instances.filter((item) => item.baseUrl !== instance.baseUrl), instance],
        })),
      clearInstances: async () => {
        await clearPxiSessions();
        set({ activeInstanceId: null, instances: [], pxiModels: {} });
      },
      removeInstance: async (id) => {
        await deletePxiSessionsForInstance(id);
        set((state) => {
          const { [id]: _removedModel, ...pxiModels } = state.pxiModels;
          return {
            activeInstanceId: state.activeInstanceId === id ? null : state.activeInstanceId,
            instances: state.instances.filter((instance) => instance.id !== id),
            pxiModels,
          };
        });
      },
      setActiveInstanceId: (activeInstanceId) => set({ activeInstanceId }),
      setHasHydrated: (hasHydrated) => set({ hasHydrated }),
      setPxiModel: (instanceId, model) =>
        set((state) => ({ pxiModels: { ...state.pxiModels, [instanceId]: model } })),
    }),
    {
      name: 'phoenix-instances',
      storage,
      partialize: (state) => ({
        activeInstanceId: state.activeInstanceId,
        instances: state.instances,
        pxiModels: state.pxiModels,
      }),
      onRehydrateStorage: (initialState) => (restoredState) => {
        if (restoredState) {
          if (
            restoredState.activeInstanceId &&
            !restoredState.instances.some((instance) => instance.id === restoredState.activeInstanceId)
          ) {
            restoredState.setActiveInstanceId(null);
          }
        }
        (restoredState ?? initialState).setHasHydrated(true);
      },
    }
  )
);
