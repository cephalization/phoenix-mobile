import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';
import { useShallow } from 'zustand/react/shallow';

import { isJsonValue } from '@/lib/json';
import { useInstanceStore } from '@/store/instances';
import type { PhoenixInstance } from '@/types/instance';

import {
  countPending,
  drainOutbox,
  hasUnsent,
  isStorableDraft,
  type OutboxDraft,
  type OutboxOperation,
  type ReplayOutcome,
  type ReplayResult,
  restoreOutbox,
} from './outbox-model';
import { instanceReachability } from './reachability';

export type {
  OutboxDraft,
  OutboxKind,
  OutboxOperation,
  OutboxStatus,
  ReplayResult,
} from './outbox-model';

/**
 * Changes made while a Phoenix server was out of reach, persisted so they
 * survive the app closing. Payloads are review values, notes, dataset rows,
 * and annotation-config drafts — never credentials, which stay in SecureStore.
 */
type OutboxState = {
  operations: OutboxOperation[];
  /** Entries dropped on launch because they no longer validated. */
  droppedCount: number;
  add: (operation: OutboxOperation) => void;
  replace: (operationId: string, operation: OutboxOperation | null) => void;
  dismissDropped: () => void;
};

const serverStorage: StateStorage = {
  getItem: () => null,
  removeItem: () => undefined,
  setItem: () => undefined,
};

const storage = createJSONStorage(() =>
  Platform.OS === 'web' && typeof window === 'undefined' ? serverStorage : AsyncStorage,
);

export const useOutboxStore = create<OutboxState>()(
  persist(
    (set) => ({
      operations: [],
      droppedCount: 0,
      add: (operation) => set((state) => ({ operations: [...state.operations, operation] })),
      replace: (operationId, operation) =>
        set((state) => ({
          operations: state.operations.flatMap((existing) =>
            existing.id !== operationId ? [existing] : operation ? [operation] : [],
          ),
        })),
      dismissDropped: () => set({ droppedCount: 0 }),
    }),
    {
      name: 'phoenix-outbox',
      version: 1,
      storage,
      partialize: (state) => ({ operations: state.operations }),
      // Validate every stored entry instead of trusting the JSON blindly.
      merge: (persisted, current) => {
        const restored = restoreOutbox(isJsonValue(persisted) ? persisted : undefined);

        return {
          ...current,
          // Anything queued before hydration finished stays after the restored entries.
          operations: [...restored.operations, ...current.operations],
          droppedCount: restored.droppedCount,
        };
      },
    },
  ),
);

/** Every change still on the device for an instance: queued, uploading, or failed. */
export function usePendingChangeCount(instanceId: string): number {
  return useOutboxStore((state) => countPending(state.operations, instanceId));
}

/** An instance's changes, oldest first. */
export function usePendingChanges(instanceId: string): OutboxOperation[] {
  return useOutboxStore(
    useShallow((state) =>
      state.operations.filter((operation) => operation.instanceId === instanceId),
    ),
  );
}

/** Whether an instance has changes waiting to send (failed ones are parked). */
export function hasUnsentChanges(instanceId: string): boolean {
  return hasUnsent(useOutboxStore.getState().operations, instanceId);
}

let sequence = 0;

function createOperationId(): string {
  sequence += 1;

  return `${Date.now().toString(36)}-${sequence.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Queues a change to send when its server is reachable. Throws when the
 * payload would not survive storage, so nothing is queued that can't replay.
 */
export function enqueue(draft: OutboxDraft): OutboxOperation {
  if (!isStorableDraft(draft)) {
    throw new Error('This change could not be saved on the device to upload later.');
  }

  const operation: OutboxOperation = {
    ...draft,
    id: createOperationId(),
    createdAt: Date.now(),
    attempts: 0,
    status: 'queued',
  };

  useOutboxStore.getState().add(operation);

  return operation;
}

export function discard(operationId: string): void {
  useOutboxStore.getState().replace(operationId, null);
}

/** Puts a failed change back in the queue with a fresh attempt budget and sends it. */
export function retry(operationId: string): Promise<ReplayResult> {
  const operation = useOutboxStore
    .getState()
    .operations.find((candidate) => candidate.id === operationId);

  if (!operation) return Promise.resolve('drained');

  if (operation.status === 'failed') {
    const { lastError, ...rest } = operation;

    useOutboxStore.getState().replace(operationId, { ...rest, status: 'queued', attempts: 0 });
  }

  return flushInstance(operation.instanceId);
}

/**
 * Sends one operation and reports how it went; registered by
 * `<OutboxReplayer />`, which owns the query client for invalidation.
 */
export type OutboxSender = (
  instance: PhoenixInstance,
  operation: OutboxOperation,
) => Promise<ReplayOutcome>;

let sender: OutboxSender | null = null;

export function setOutboxSender(next: OutboxSender | null): void {
  sender = next;
}

const flushing = new Map<string, Promise<ReplayResult>>();

/**
 * Sends an instance's queued changes in order. Concurrent calls share one
 * replay, which re-reads the queue before each send, so changes queued while
 * it runs are included. Does nothing while the server is known to be offline.
 */
export function flushInstance(instanceId: string): Promise<ReplayResult> {
  const running = flushing.get(instanceId);

  if (running) return running;

  const send = sender;

  // Before both stores load, a missing instance would look removed.
  if (!send || !useOutboxStore.persist.hasHydrated() || !useInstanceStore.getState().hasHydrated) {
    return Promise.resolve('paused');
  }

  if (instanceReachability(instanceId) === 'offline') return Promise.resolve('offline');

  const instance = useInstanceStore.getState().instances.find((item) => item.id === instanceId);

  if (!instance) {
    // The connection was removed; its changes can never be sent.
    for (const operation of useOutboxStore.getState().operations) {
      if (operation.instanceId === instanceId) discard(operation.id);
    }

    return Promise.resolve('drained');
  }

  const run = drainOutbox(
    {
      next: (id) =>
        useOutboxStore
          .getState()
          .operations.find(
            (operation) => operation.instanceId === id && operation.status === 'queued',
          ),
      replace: (operationId, operation) =>
        useOutboxStore.getState().replace(operationId, operation),
    },
    instanceId,
    (operation) => send(instance, operation),
  ).finally(() => flushing.delete(instanceId));

  flushing.set(instanceId, run);

  return run;
}

/** Requeues an instance's failed changes and sends everything waiting. */
export function retryAll(instanceId: string): Promise<ReplayResult> {
  for (const operation of useOutboxStore.getState().operations) {
    if (operation.instanceId !== instanceId || operation.status !== 'failed') continue;

    const { lastError, ...rest } = operation;

    useOutboxStore.getState().replace(operation.id, { ...rest, status: 'queued', attempts: 0 });
  }

  return flushInstance(instanceId);
}
