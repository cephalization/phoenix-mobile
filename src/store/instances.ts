import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import type { PhoenixInstance } from '@/types/instance';
import { revokeAndDeleteCredentials } from '@/features/auth/session';
import { clearOfflineData } from '@/features/offline/persistence';
import { addRecentModel } from '@/features/pxi/model-search';
import type { ModelSelection } from '@/features/pxi/types';
import { useSessionReviewSettingsStore } from '@/store/session-review-settings';

type InstanceState = {
  instances: PhoenixInstance[];
  activeInstanceId: string | null;
  pxiModels: Record<string, ModelSelection>;
  /** Recently picked PXI models per instance, newest first; any model name is kept. */
  pxiRecentModels: Record<string, ModelSelection[]>;
  pendingOAuthRegistrations: Record<string, PendingOAuthRegistration>;
  hasHydrated: boolean;
  addInstance: (instance: PhoenixInstance) => Promise<void>;
  clearInstances: () => Promise<void>;
  removeInstance: (id: string) => Promise<void>;
  setActiveInstanceId: (id: string | null) => void;
  setHasHydrated: (hasHydrated: boolean) => void;
  setPxiModel: (instanceId: string, model: ModelSelection) => void;
  recordRecentPxiModel: (instanceId: string, model: ModelSelection) => void;
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

const storage = createJSONStorage(() => AsyncStorage);

export const useInstanceStore = create<InstanceState>()(
  persist(
    (set) => ({
      instances: [],
      activeInstanceId: null,
      pxiModels: {},
      pxiRecentModels: {},
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

        const replacedIds = replacedInstances
          .filter((item) => item.id !== instance.id)
          .map((item) => item.id);

        useSessionReviewSettingsStore.getState().clearInstanceSettings(replacedIds);
        await Promise.all(replacedIds.map((id) => clearOfflineData(id)));
      },
      clearInstances: async () => {
        const instances = useInstanceStore.getState().instances;
        await Promise.all(instances.map((instance) => revokeAndDeleteCredentials(instance, true)));
        useSessionReviewSettingsStore.getState().clearAllSettings();
        await Promise.all(instances.map((instance) => clearOfflineData(instance.id)));
        set({
          activeInstanceId: null,
          instances: [],
          pendingOAuthRegistrations: {},
          pxiModels: {},
          pxiRecentModels: {},
        });
      },
      removeInstance: async (id) => {
        const instance = useInstanceStore.getState().instances.find((item) => item.id === id);

        if (instance) await revokeAndDeleteCredentials(instance, true);
        useSessionReviewSettingsStore.getState().clearInstanceSettings([id]);
        await clearOfflineData(id);
        set((state) => {
          const { [id]: _removedModel, ...pxiModels } = state.pxiModels;
          const { [id]: _removedRecent, ...pxiRecentModels } = state.pxiRecentModels;

          return {
            activeInstanceId: state.activeInstanceId === id ? null : state.activeInstanceId,
            instances: state.instances.filter((item) => item.id !== id),
            pxiModels,
            pxiRecentModels,
          };
        });
      },
      setActiveInstanceId: (activeInstanceId) => set({ activeInstanceId }),
      setHasHydrated: (hasHydrated) => set({ hasHydrated }),
      setPxiModel: (instanceId, model) =>
        set((state) => ({ pxiModels: { ...state.pxiModels, [instanceId]: model } })),
      recordRecentPxiModel: (instanceId, model) =>
        set((state) => ({
          pxiRecentModels: {
            ...state.pxiRecentModels,
            [instanceId]: addRecentModel(state.pxiRecentModels[instanceId] ?? [], model),
          },
        })),
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
        pxiRecentModels: state.pxiRecentModels,
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

/** The instance the app is showing: the one last chosen, else the first stored. */
export function useActiveInstance(): PhoenixInstance | undefined {
  return useInstanceStore(
    (state) =>
      state.instances.find((instance) => instance.id === state.activeInstanceId) ??
      state.instances[0],
  );
}
