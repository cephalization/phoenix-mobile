import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';

import type { PhoenixInstance } from '@/types/instance';
import { revokeAndDeleteCredentials } from '@/features/auth/session';
import type { ModelSelection } from '@/features/pxi/types';
import { useSessionReviewSettingsStore } from '@/store/session-review-settings';

type InstanceState = {
  instances: PhoenixInstance[];
  activeInstanceId: string | null;
  pxiModels: Record<string, ModelSelection>;
  pendingOAuthRegistrations: Record<string, PendingOAuthRegistration>;
  hasHydrated: boolean;
  addInstance: (instance: PhoenixInstance) => Promise<void>;
  clearInstances: () => Promise<void>;
  removeInstance: (id: string) => Promise<void>;
  setActiveInstanceId: (id: string | null) => void;
  setHasHydrated: (hasHydrated: boolean) => void;
  setPxiModel: (instanceId: string, model: ModelSelection) => void;
  savePendingOAuthRegistration: (registration: PendingOAuthRegistration) => void;
};

export type PendingOAuthRegistration = {
  baseUrl: string;
  clientId: string;
  issuer: string;
  registrationEndpoint: string;
  createdAt: number;
};

const PENDING_REGISTRATION_TTL_MS = 6 * 24 * 60 * 60_000;

const serverStorage: StateStorage = {
  getItem: () => null,
  removeItem: () => undefined,
  setItem: () => undefined,
};

const storage = createJSONStorage(() =>
  Platform.OS === 'web' && typeof window === 'undefined' ? serverStorage : AsyncStorage,
);

export const useInstanceStore = create<InstanceState>()(
  persist(
    (set) => ({
      instances: [],
      activeInstanceId: null,
      pxiModels: {},
      pendingOAuthRegistrations: {},
      hasHydrated: false,
      addInstance: async (instance) => {
        const replacedInstances = useInstanceStore
          .getState()
          .instances.filter((item) => item.baseUrl === instance.baseUrl);

        const replaced = replacedInstances[0];

        if (
          replaced &&
          replaced.auth.type === 'oauth2' &&
          (instance.auth.type !== 'oauth2' ||
            replaced.auth.credentialKey !== instance.auth.credentialKey)
        ) {
          try {
            await revokeAndDeleteCredentials(replaced, true);
          } catch (error) {
            await revokeAndDeleteCredentials(instance).catch(() => undefined);
            throw error;
          }
        }

        set((state) => ({
          instances: [
            ...state.instances.filter((item) => item.baseUrl !== instance.baseUrl),
            instance,
          ],
          pendingOAuthRegistrations: Object.fromEntries(
            Object.entries(state.pendingOAuthRegistrations).filter(
              ([baseUrl]) => baseUrl !== instance.baseUrl,
            ),
          ),
        }));
        useSessionReviewSettingsStore
          .getState()
          .clearInstanceSettings(
            replacedInstances.filter((item) => item.id !== instance.id).map((item) => item.id),
          );
      },
      clearInstances: async () => {
        const instances = useInstanceStore.getState().instances;
        await Promise.all(instances.map((instance) => revokeAndDeleteCredentials(instance, true)));
        useSessionReviewSettingsStore.getState().clearAllSettings();
        set({
          activeInstanceId: null,
          instances: [],
          pendingOAuthRegistrations: {},
          pxiModels: {},
        });
      },
      removeInstance: async (id) => {
        const instance = useInstanceStore.getState().instances.find((item) => item.id === id);

        if (instance) await revokeAndDeleteCredentials(instance, true);
        useSessionReviewSettingsStore.getState().clearInstanceSettings([id]);
        set((state) => {
          const { [id]: _removedModel, ...pxiModels } = state.pxiModels;

          return {
            activeInstanceId: state.activeInstanceId === id ? null : state.activeInstanceId,
            instances: state.instances.filter((item) => item.id !== id),
            pxiModels,
          };
        });
      },
      setActiveInstanceId: (activeInstanceId) => set({ activeInstanceId }),
      setHasHydrated: (hasHydrated) => set({ hasHydrated }),
      setPxiModel: (instanceId, model) =>
        set((state) => ({ pxiModels: { ...state.pxiModels, [instanceId]: model } })),
      savePendingOAuthRegistration: (registration) =>
        set((state) => ({
          pendingOAuthRegistrations: {
            ...state.pendingOAuthRegistrations,
            [registration.baseUrl]: registration,
          },
        })),
    }),
    {
      name: 'phoenix-instances',
      storage,
      partialize: (state) => ({
        activeInstanceId: state.activeInstanceId,
        instances: state.instances,
        pendingOAuthRegistrations: state.pendingOAuthRegistrations,
        pxiModels: state.pxiModels,
      }),
      onRehydrateStorage: (initialState) => (restoredState) => {
        if (restoredState) {
          const now = Date.now();
          restoredState.pendingOAuthRegistrations = Object.fromEntries(
            Object.entries(restoredState.pendingOAuthRegistrations ?? {}).filter(
              ([, registration]) => now - registration.createdAt <= PENDING_REGISTRATION_TTL_MS,
            ),
          );

          if (
            restoredState.activeInstanceId &&
            !restoredState.instances.some(
              (instance) => instance.id === restoredState.activeInstanceId,
            )
          ) {
            restoredState.setActiveInstanceId(null);
          }
        }

        (restoredState ?? initialState).setHasHydrated(true);
      },
    },
  ),
);
