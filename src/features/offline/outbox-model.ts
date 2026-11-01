import { z } from 'zod';

import type {
  SessionAnnotationData,
  SessionDatasetUploadBody,
} from '@/features/session-review/api';
import type { AnnotationConfigWrite, SessionNoteWrite } from '@/features/session-review/types';
import {
  isJsonArray,
  isJsonObject,
  isJsonValue,
  type JsonObject,
  type JsonValue,
  parseJsonValue,
} from '@/lib/json';

/**
 * A change made while a Phoenix server could not be reached, waiting to be
 * sent. Payloads are the already-validated request inputs, so replay sends
 * exactly what the user saw accepted, deterministic identifiers included.
 */
export type OutboxStatus = 'queued' | 'sending' | 'failed';

type OutboxEntry = {
  id: string;
  instanceId: string;
  /** Epoch milliseconds. */
  createdAt: number;
  /** Sends that reached the server and failed; network failures don't count. */
  attempts: number;
  status: OutboxStatus;
  lastError?: string;
};

export type OutboxPayload =
  | {
      kind: 'sessionAnnotations';
      projectId: string;
      payload: { annotations: SessionAnnotationData[] };
    }
  | {
      kind: 'sessionAnnotation';
      projectId: string;
      payload: { annotation: SessionAnnotationData };
    }
  | { kind: 'sessionNote'; projectId: string; payload: SessionNoteWrite }
  | {
      kind: 'addSessionToDataset';
      projectId?: string;
      payload: { body: SessionDatasetUploadBody; sessionId: string };
    }
  | { kind: 'createAnnotationConfig'; projectId: string; payload: AnnotationConfigWrite };

export type OutboxKind = OutboxPayload['kind'];

export type OutboxOperation = OutboxEntry & OutboxPayload;

/** What `enqueue` takes: the payload and its instance; the queue fills in the rest. */
export type OutboxDraft = OutboxPayload & { instanceId: string };

/** Sends before an op that keeps reaching a failing server is parked as failed. */
export const MaxOutboxAttempts = 5;

const jsonValueSchema = z.custom<JsonValue>(isJsonValue);

const jsonObjectSchema = z.custom<JsonObject>((value) => isJsonObject(value) && isJsonValue(value));

const annotationDataSchema = z.object({
  annotator_kind: z.enum(['LLM', 'CODE', 'HUMAN']),
  identifier: z.string().optional(),
  metadata: z.record(z.string(), jsonValueSchema).nullish(),
  name: z.string().min(1),
  result: z
    .object({
      explanation: z.string().nullish(),
      label: z.string().nullish(),
      score: z.number().nullish(),
    })
    .nullish(),
  session_id: z.string().min(1),
}) satisfies z.ZodType<SessionAnnotationData>;

const noteSchema = z.object({
  identifier: z.string().min(1),
  note: z.string().min(1),
  sessionId: z.string().min(1),
}) satisfies z.ZodType<SessionNoteWrite>;

const directionSchema = z.enum(['MINIMIZE', 'MAXIMIZE', 'NONE']);

const annotationConfigSchema = z.object({
  description: z.string().optional(),
  draft: z.discriminatedUnion('type', [
    z.object({
      type: z.literal('CATEGORICAL'),
      optimizationDirection: directionSchema,
      values: z.array(z.object({ label: z.string(), score: z.number().optional() })),
    }),
    z.object({
      type: z.literal('CONTINUOUS'),
      optimizationDirection: directionSchema,
      lowerBound: z.number().optional(),
      upperBound: z.number().optional(),
    }),
    z.object({ type: z.literal('FREEFORM') }),
  ]),
  name: z.string().min(1),
}) satisfies z.ZodType<AnnotationConfigWrite>;

const datasetBodySchema = z.object({
  action: z.enum(['create', 'append']),
  description: z.string().optional(),
  inputs: z.array(jsonObjectSchema),
  metadata: z.array(jsonObjectSchema),
  name: z.string().min(1),
  outputs: z.array(jsonObjectSchema),
  span_ids: z.array(z.string()),
}) satisfies z.ZodType<SessionDatasetUploadBody>;

const entrySchema = {
  id: z.string().min(1),
  instanceId: z.string().min(1),
  createdAt: z.number(),
  attempts: z.number().int().min(0),
  status: z.enum(['queued', 'sending', 'failed']),
  lastError: z.string().optional(),
};

const operationSchema = z.discriminatedUnion('kind', [
  z.object({
    ...entrySchema,
    kind: z.literal('sessionAnnotations'),
    projectId: z.string().min(1),
    payload: z.object({ annotations: z.array(annotationDataSchema).min(1) }),
  }),
  z.object({
    ...entrySchema,
    kind: z.literal('sessionAnnotation'),
    projectId: z.string().min(1),
    payload: z.object({ annotation: annotationDataSchema }),
  }),
  z.object({
    ...entrySchema,
    kind: z.literal('sessionNote'),
    projectId: z.string().min(1),
    payload: noteSchema,
  }),
  z.object({
    ...entrySchema,
    kind: z.literal('addSessionToDataset'),
    projectId: z.string().optional(),
    payload: z.object({ body: datasetBodySchema, sessionId: z.string().min(1) }),
  }),
  z.object({
    ...entrySchema,
    kind: z.literal('createAnnotationConfig'),
    projectId: z.string().min(1),
    payload: annotationConfigSchema,
  }),
]) satisfies z.ZodType<OutboxOperation>;

export type RestoredOutbox = {
  operations: OutboxOperation[];
  /** Stored entries that no longer validate and were dropped. */
  droppedCount: number;
};

/**
 * Restores the queue from storage. Each entry is validated on its own, so one
 * corrupt or outdated entry is dropped and counted instead of losing the rest.
 * An entry left `sending` by a closed app goes back to `queued`; every write
 * the outbox replays is idempotent or conflict-tolerant.
 */
export function restoreOutbox(stored: JsonValue | undefined): RestoredOutbox {
  const entries = isJsonObject(stored) ? stored.operations : undefined;

  if (!isJsonArray(entries)) return { operations: [], droppedCount: 0 };

  const operations: OutboxOperation[] = [];
  let droppedCount = 0;

  for (const entry of entries) {
    const parsed = operationSchema.safeParse(entry);

    if (!parsed.success) {
      droppedCount += 1;
      continue;
    }

    operations.push(
      parsed.data.status === 'sending' ? { ...parsed.data, status: 'queued' } : parsed.data,
    );
  }

  return { operations, droppedCount };
}

/** Whether a draft survives a JSON round trip unchanged in meaning. */
export function isStorableDraft(draft: OutboxDraft): boolean {
  const probe: OutboxOperation = {
    ...draft,
    id: 'probe',
    createdAt: 0,
    attempts: 0,
    status: 'queued',
  };

  const stored = parseJsonValue(JSON.stringify({ operations: [probe] }));

  return stored !== null && restoreOutbox(stored).operations.length === 1;
}

/** How one replay attempt ended. */
export type ReplayOutcome =
  | { type: 'sent' }
  /** The request never reached the server. */
  | { type: 'offline' }
  /** The server rejected it for good (validation, permissions, a 4xx). */
  | { type: 'rejected'; message: string }
  /** The server answered with something worth retrying (5xx, 408, 429). */
  | { type: 'retryable'; message: string };

/** The operation after an attempt, or `null` once it is done and leaves the queue. */
export function settleOperation(
  operation: OutboxOperation,
  outcome: ReplayOutcome,
  maxAttempts: number = MaxOutboxAttempts,
): OutboxOperation | null {
  if (outcome.type === 'sent') return null;

  if (outcome.type === 'offline') return { ...operation, status: 'queued' };

  const attempts = operation.attempts + 1;

  if (outcome.type === 'rejected' || attempts >= maxAttempts) {
    return { ...operation, attempts, status: 'failed', lastError: outcome.message };
  }

  return { ...operation, attempts, status: 'queued', lastError: outcome.message };
}

/**
 * The live queue a replay drains. Replay re-reads it before every send, so
 * changes queued or discarded mid-replay are respected.
 */
export type OutboxQueue = {
  /** The oldest `queued` operation for the instance, if any. */
  next: (instanceId: string) => OutboxOperation | undefined;
  /** Replaces an operation by id, or removes it for `null`; a missing id is ignored. */
  replace: (operationId: string, operation: OutboxOperation | null) => void;
};

/**
 * `drained` when nothing is left to send, `offline` when the server went away
 * (the rest stays queued), `paused` after a retryable server error (sending
 * the rest out of order could let an older write land after a newer one).
 */
export type ReplayResult = 'drained' | 'offline' | 'paused';

/**
 * Sends an instance's queued operations oldest first, one at a time.
 * Rejected operations are parked as failed and replay moves on.
 */
export async function drainOutbox(
  queue: OutboxQueue,
  instanceId: string,
  send: (operation: OutboxOperation) => Promise<ReplayOutcome>,
  maxAttempts: number = MaxOutboxAttempts,
): Promise<ReplayResult> {
  for (;;) {
    const operation = queue.next(instanceId);

    if (!operation) return 'drained';
    queue.replace(operation.id, { ...operation, status: 'sending' });

    const outcome = await send(operation);
    const settled = settleOperation(operation, outcome, maxAttempts);

    queue.replace(operation.id, settled);

    if (outcome.type === 'offline') return 'offline';

    if (outcome.type === 'retryable' && settled?.status === 'queued') return 'paused';
  }
}

/** Replays a plain list, for tests and previews: the remaining queue and why it stopped. */
export async function replayQueue(
  operations: readonly OutboxOperation[],
  instanceId: string,
  send: (operation: OutboxOperation) => Promise<ReplayOutcome>,
  maxAttempts: number = MaxOutboxAttempts,
): Promise<{ operations: OutboxOperation[]; result: ReplayResult }> {
  let current = [...operations];

  const result = await drainOutbox(
    {
      next: (id) =>
        current.find((operation) => operation.instanceId === id && operation.status === 'queued'),
      replace: (operationId, operation) => {
        current = current.flatMap((existing) =>
          existing.id !== operationId ? [existing] : operation ? [operation] : [],
        );
      },
    },
    instanceId,
    send,
    maxAttempts,
  );

  return { operations: current, result };
}

/** Counts every operation still on the device for an instance, failed ones included. */
export function countPending(operations: readonly OutboxOperation[], instanceId: string): number {
  return operations.filter((operation) => operation.instanceId === instanceId).length;
}

/** Whether an instance has operations waiting to send (failed ones are parked). */
export function hasUnsent(operations: readonly OutboxOperation[], instanceId: string): boolean {
  return operations.some(
    (operation) => operation.instanceId === instanceId && operation.status !== 'failed',
  );
}
