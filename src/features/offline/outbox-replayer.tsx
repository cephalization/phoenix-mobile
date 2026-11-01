import { type QueryClient, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { AppState } from 'react-native';

import {
  createProjectAnnotationConfig,
  postSessionAnnotations,
  type SessionDatasetUploadBody,
  SessionReviewValidationError,
  uploadSessionDataset,
  writeSessionNote,
} from '@/features/session-review/api';
import { invalidateAfterReplay } from '@/hooks/use-phoenix-sessions';
import { useInstanceStore } from '@/store/instances';
import type { PhoenixInstance } from '@/types/instance';

import { flushInstance, setOutboxSender, useOutboxStore } from './outbox';
import { classifyReplayError } from './outbox-errors';
import type { OutboxOperation, ReplayOutcome } from './outbox-model';
import { instanceReachability, onInstanceReachable } from './reachability';

/** While the app is active, how often a server that answered with an error is retried. */
const RetryIntervalMs = 30_000;

/**
 * Uploads queued changes: on launch for every server not known to be offline,
 * whenever a server becomes reachable again, and periodically while one that
 * is reachable still has changes waiting (after a retryable server error).
 * Mount once, inside the query client provider.
 */
export function OutboxReplayer() {
  const queryClient = useQueryClient();
  const instancesHydrated = useInstanceStore((state) => state.hasHydrated);

  useEffect(() => {
    setOutboxSender((instance, operation) => sendOperation(queryClient, instance, operation));

    return () => setOutboxSender(null);
  }, [queryClient]);

  useEffect(() => {
    if (!instancesHydrated) return;

    const flushWaiting = () => {
      const waiting = new Set(
        useOutboxStore
          .getState()
          .operations.filter((operation) => operation.status === 'queued')
          .map((operation) => operation.instanceId),
      );

      for (const instanceId of waiting) {
        if (instanceReachability(instanceId) !== 'offline') void flushInstance(instanceId);
      }
    };

    let interval: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      flushWaiting();
      interval ??= setInterval(flushWaiting, RetryIntervalMs);
    };

    const stop = () => {
      if (interval !== null) clearInterval(interval);
      interval = null;
    };

    const offHydration = useOutboxStore.persist.onFinishHydration(flushWaiting);

    if (AppState.currentState === 'active') start();

    const appState = AppState.addEventListener('change', (state) =>
      state === 'active' ? start() : stop(),
    );

    const offReachable = onInstanceReachable((instanceId) => void flushInstance(instanceId));

    return () => {
      stop();
      offHydration();
      appState.remove();
      offReachable();
    };
  }, [instancesHydrated]);

  return null;
}

/** Sends one queued change through the same API the live write uses. */
async function sendOperation(
  queryClient: QueryClient,
  instance: PhoenixInstance,
  operation: OutboxOperation,
): Promise<ReplayOutcome> {
  try {
    await sendPayload(instance, operation);
  } catch (error) {
    return error instanceof Error
      ? classifyReplayError(error)
      : { type: 'retryable', message: 'Phoenix could not accept this change.' };
  }

  void invalidateAfterReplay(queryClient, operation);

  return { type: 'sent' };
}

async function sendPayload(instance: PhoenixInstance, operation: OutboxOperation): Promise<void> {
  switch (operation.kind) {
    case 'sessionAnnotations':
      await postSessionAnnotations(instance, operation.payload.annotations);

      return;

    case 'sessionAnnotation':
      await postSessionAnnotations(instance, [operation.payload.annotation]);

      return;

    case 'sessionNote':
      await writeSessionNote(instance, operation.payload);

      return;

    case 'createAnnotationConfig':
      // Recovers a matching config left by an attempt that failed before assignment.
      await createProjectAnnotationConfig(instance, operation.projectId, operation.payload);

      return;

    case 'addSessionToDataset':
      await uploadDataset(instance, operation.payload.body);
  }
}

/**
 * A queued create whose name now exists (an earlier queued add created it, or
 * someone else did meanwhile) appends instead, so the examples still land.
 */
async function uploadDataset(instance: PhoenixInstance, body: SessionDatasetUploadBody) {
  try {
    await uploadSessionDataset(instance, body);
  } catch (error) {
    const nameTaken =
      body.action === 'create' &&
      error instanceof SessionReviewValidationError &&
      error.issues.some((issue) => issue.field === 'datasetName');

    if (!nameTaken) throw error;

    await uploadSessionDataset(instance, {
      action: 'append',
      inputs: body.inputs,
      metadata: body.metadata,
      name: body.name,
      outputs: body.outputs,
      span_ids: body.span_ids,
    });
  }
}
