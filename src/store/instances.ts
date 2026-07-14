import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';

import type { PhoenixInstance } from '@/types/instance';

type InstanceState = {
  instances: PhoenixInstance[];
  hasHydrated: boolean;
  addInstance: (instance: PhoenixInstance) => void;
  clearInstances: () => void;
  removeInstance: (id: string) => void;
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

export const useInstanceStore = create<InstanceState>()(
  persist(
    (set) => ({
      instances: [],
      hasHydrated: false,
      addInstance: (instance) =>
        set((state) => ({
          instances: [...state.instances.filter((item) => item.baseUrl !== instance.baseUrl), instance],
        })),
      clearInstances: () => set({ instances: [] }),
      removeInstance: (id) =>
        set((state) => ({ instances: state.instances.filter((instance) => instance.id !== id) })),
      setHasHydrated: (hasHydrated) => set({ hasHydrated }),
    }),
    {
      name: 'phoenix-instances',
      storage,
      partialize: (state) => ({ instances: state.instances }),
      onRehydrateStorage: (state) => () => state.setHasHydrated(true),
    }
  )
);
