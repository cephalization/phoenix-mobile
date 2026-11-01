import {
  type QueryClient,
  useInfiniteQuery,
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';

import {
  enqueue,
  flushInstance,
  hasUnsentChanges,
  type OutboxDraft,
  type OutboxOperation,
} from '@/features/offline/outbox';
import { isOfflineError } from '@/features/offline/outbox-errors';
import { persistQueryNow } from '@/features/offline/persistence';
import { instanceReachability } from '@/features/offline/reachability';
import {
  buildAnnotationConfigData,
  buildSessionAnnotationData,
  buildSessionDatasetUpload,
  createProjectAnnotationConfig,
  createSessionAnnotationBatches,
  fetchDatasets,
  fetchProjectAnnotationConfigs,
  fetchSession,
  fetchSessionAnnotations,
  fetchSessionPage,
  fetchSessionPxiNotes,
  fetchSessionTurns,
  postSessionAnnotations,
  type SessionAnnotationData,
  type SessionDatasetUploadBody,
  SessionReviewValidationError,
  uploadSessionDataset,
  writeSessionNote,
} from '@/features/session-review/api';
import { uniqueTrimmed } from '@/features/session-review/classifier';
import type {
  AnnotationConfigCreateData,
  AnnotationConfigWrite,
  DatasetSummary,
  SessionAnnotation,
  SessionAnnotationConfig,
  SessionAnnotationWrite,
  SessionAnnotationsWrite,
  SessionData,
  SessionDatasetWrite,
  SessionDatasetWriteResult,
  SessionNoteWrite,
  SessionTurn,
} from '@/features/session-review/types';
import { phoenixQueryKeys, type PhoenixViewer } from '@/hooks/use-phoenix-data';
import { isJsonArray } from '@/lib/json';
import type { PhoenixInstance } from '@/types/instance';

const missing = 'missing';
const initialSessionCursor: string | null = null;

export const phoenixSessionQueryKeys = {
  project: (instanceId: string, projectId: string) =>
    [...phoenixQueryKeys.instance(instanceId), 'project', projectId, 'sessions'] as const,
  list: (instanceId: string, projectId: string) =>
    [...phoenixSessionQueryKeys.project(instanceId, projectId), 'list'] as const,
  detail: (instanceId: string, projectId: string, sessionId: string) =>
    [...phoenixSessionQueryKeys.project(instanceId, projectId), 'session', sessionId] as const,
  turns: (instanceId: string, projectId: string, sessionId: string) =>
    [...phoenixSessionQueryKeys.detail(instanceId, projectId, sessionId), 'turns'] as const,
  annotationConfigs: (instanceId: string, projectId: string) =>
    [...phoenixSessionQueryKeys.project(instanceId, projectId), 'annotation-configs'] as const,
  annotations: (instanceId: string, projectId: string) =>
    [...phoenixSessionQueryKeys.project(instanceId, projectId), 'annotations'] as const,
  annotationsForSessions: (
    instanceId: string,
    projectId: string,
    sessionIds: readonly string[],
    annotationNames: readonly string[],
  ) =>
    [
      ...phoenixSessionQueryKeys.annotations(instanceId, projectId),
      [...sessionIds].sort(),
      [...annotationNames].sort(),
    ] as const,
  datasets: (instanceId: string) => [...phoenixQueryKeys.instance(instanceId), 'datasets'] as const,
  pxiNotes: (instanceId: string, projectId: string, sessionId: string) =>
    [...phoenixSessionQueryKeys.project(instanceId, projectId), 'pxi-notes', sessionId] as const,
};

export function usePhoenixProjectSessions(
  instance: PhoenixInstance | undefined,
  projectId: string | undefined,
) {
  return useInfiniteQuery({
    queryKey: phoenixSessionQueryKeys.list(instance?.id ?? missing, projectId ?? missing),
    queryFn: ({ pageParam }) => {
      if (!instance || !projectId) throw new Error('Phoenix project not found.');

      return fetchSessionPage(instance, projectId, pageParam);
    },
    initialPageParam: initialSessionCursor,
    getNextPageParam: (lastPage, _pages, _lastPageParam, pageParams) => {
      const cursor = lastPage.nextCursor;

      return cursor && !pageParams.includes(cursor) ? cursor : undefined;
    },
    enabled: Boolean(instance && projectId),
  });
}

export function usePhoenixSession(
  instance: PhoenixInstance | undefined,
  projectId: string | undefined,
  sessionIdentifier: string | undefined,
) {
  return useQuery({
    queryKey: phoenixSessionQueryKeys.detail(
      instance?.id ?? missing,
      projectId ?? missing,
      sessionIdentifier ?? missing,
    ),
    queryFn: () => {
      if (!instance || !sessionIdentifier) throw new Error('Phoenix session not found.');

      return fetchSession(instance, sessionIdentifier);
    },
    enabled: Boolean(instance && projectId && sessionIdentifier),
  });
}

export function usePhoenixSessionTurns(
  instance: PhoenixInstance | undefined,
  projectId: string | undefined,
  session: SessionData | undefined,
) {
  return useQuery({
    queryKey: phoenixSessionQueryKeys.turns(
      instance?.id ?? missing,
      projectId ?? missing,
      session
        ? `${session.session_id}:${session.traces
            .map((trace) => trace.trace_id)
            .sort()
            .join(',')}`
        : missing,
    ),
    queryFn: () => {
      if (!instance || !session) throw new Error('Phoenix session not found.');

      return fetchSessionTurns(instance, session);
    },
    enabled: Boolean(instance && projectId && session),
  });
}

export function usePhoenixProjectAnnotationConfigs(
  instance: PhoenixInstance | undefined,
  projectId: string | undefined,
) {
  return useQuery({
    queryKey: phoenixSessionQueryKeys.annotationConfigs(
      instance?.id ?? missing,
      projectId ?? missing,
    ),
    queryFn: () => {
      if (!instance || !projectId) throw new Error('Phoenix project not found.');

      return fetchProjectAnnotationConfigs(instance, projectId);
    },
    enabled: Boolean(instance && projectId),
  });
}

export function useCreatePhoenixAnnotationConfig(
  instance: PhoenixInstance | undefined,
  projectId: string | undefined,
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (
      input: AnnotationConfigWrite,
    ): Promise<WriteOutcome<SessionAnnotationConfig>> => {
      if (!instance || !projectId) throw new Error('Phoenix project not found.');

      // Validates the draft before anything is sent or queued.
      const data = buildAnnotationConfigData(input);

      return sendOrQueue(
        instance.id,
        { kind: 'createAnnotationConfig', instanceId: instance.id, projectId, payload: input },
        () => createProjectAnnotationConfig(instance, projectId, input),
        (operationId) =>
          addOptimisticAnnotationConfig(queryClient, instance.id, projectId, data, operationId),
      );
    },
    onSuccess: async (outcome) => {
      if (!instance || !projectId || outcome.queued) return;
      await invalidateAnnotationConfigs(queryClient, instance.id, projectId);
    },
  });
}

export function usePhoenixSessionPxiNotes(
  instance: PhoenixInstance | undefined,
  projectId: string | undefined,
  sessionId: string | undefined,
  turns: SessionTurn[] | undefined,
) {
  const spanIds = (turns ?? [])
    .flatMap((turn) => (turn.rootSpan ? [turn.rootSpan.context.span_id] : []))
    .sort();

  return useQuery({
    queryKey: [
      ...phoenixSessionQueryKeys.pxiNotes(
        instance?.id ?? missing,
        projectId ?? missing,
        sessionId ?? missing,
      ),
      spanIds,
    ],
    queryFn: () => {
      if (!instance || !projectId) throw new Error('Phoenix project not found.');

      return fetchSessionPxiNotes(instance, projectId, spanIds);
    },
    enabled: Boolean(instance && projectId && sessionId && spanIds.length > 0),
  });
}

export function usePhoenixSessionAnnotations(
  instance: PhoenixInstance | undefined,
  projectId: string | undefined,
  sessionIdPages: readonly (readonly string[])[],
  annotationNames: readonly string[],
) {
  const batches = createSessionAnnotationBatches(sessionIdPages);
  const names = uniqueTrimmed(annotationNames);
  const enabled = Boolean(instance && projectId && batches.length > 0 && names.length > 0);

  const queries = useQueries({
    queries: batches.map((sessionIds) => ({
      queryKey: phoenixSessionQueryKeys.annotationsForSessions(
        instance?.id ?? missing,
        projectId ?? missing,
        sessionIds,
        names,
      ),
      queryFn: () => {
        if (!instance || !projectId) throw new Error('Phoenix project not found.');

        return fetchSessionAnnotations(instance, projectId, sessionIds, names);
      },
      enabled,
    })),
  });

  const error = queries.find((query) => query.error)?.error ?? null;

  return {
    data: queries.flatMap((query) => query.data ?? []),
    error,
    isEnabled: enabled,
    isError: Boolean(error),
    isPending: enabled && queries.some((query) => query.isPending),
    isRefetching: queries.some((query) => query.isRefetching),
    isSuccess: !enabled || queries.every((query) => query.isSuccess),
    refetch: async () => {
      const results = await Promise.all(queries.map((query) => query.refetch()));

      return { isError: results.some((result) => result.isError) };
    },
  };
}

export function useWritePhoenixSessionAnnotation(
  instance: PhoenixInstance | undefined,
  projectId: string | undefined,
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: SessionAnnotationWrite): Promise<WriteOutcome<{ id: string }>> => {
      if (!instance || !projectId) throw new Error('Phoenix project not found.');

      const annotation = buildSessionAnnotationData(input);

      return sendOrQueue(
        instance.id,
        {
          kind: 'sessionAnnotation',
          instanceId: instance.id,
          projectId,
          payload: { annotation },
        },
        async () => (await postSessionAnnotations(instance, [annotation]))[0],
        (operationId) => {
          applyOptimisticAnnotations(
            queryClient,
            instance.id,
            projectId,
            [annotation],
            operationId,
          );

          return null;
        },
      );
    },
    onSuccess: async (outcome, input) => {
      if (!instance || !projectId || outcome.queued) return;
      await invalidateSessionAnnotations(queryClient, instance.id, projectId, [input.sessionId]);
    },
  });
}

export function useWritePhoenixSessionAnnotations(
  instance: PhoenixInstance | undefined,
  projectId: string | undefined,
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: SessionAnnotationsWrite): Promise<WriteOutcome<{ id: string }[]>> => {
      if (!instance || !projectId) throw new Error('Phoenix project not found.');

      const annotations = input.annotations.map(buildSessionAnnotationData);

      if (annotations.length === 0) return { queued: false, value: [] };

      return sendOrQueue(
        instance.id,
        {
          kind: 'sessionAnnotations',
          instanceId: instance.id,
          projectId,
          payload: { annotations },
        },
        () => postSessionAnnotations(instance, annotations),
        (operationId) => {
          applyOptimisticAnnotations(queryClient, instance.id, projectId, annotations, operationId);

          return null;
        },
      );
    },
    onSuccess: async (outcome) => {
      if (!instance || !projectId || outcome.queued) return;
      await queryClient.invalidateQueries({
        queryKey: phoenixSessionQueryKeys.annotations(instance.id, projectId),
      });
    },
  });
}

export function usePhoenixDatasets(instance: PhoenixInstance | undefined) {
  return useQuery({
    queryKey: phoenixSessionQueryKeys.datasets(instance?.id ?? missing),
    queryFn: () => {
      if (!instance) throw new Error('Phoenix instance not found.');

      return fetchDatasets(instance);
    },
    enabled: Boolean(instance),
  });
}

export function useAddPhoenixSessionToDataset(instance: PhoenixInstance | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (
      input: SessionDatasetWrite,
    ): Promise<WriteOutcome<SessionDatasetWriteResult>> => {
      if (!instance) throw new Error('Phoenix instance not found.');

      const { body } = buildSessionDatasetUpload(input);

      return sendOrQueue(
        instance.id,
        {
          kind: 'addSessionToDataset',
          instanceId: instance.id,
          payload: { body, sessionId: input.sessionId },
        },
        () => uploadSessionDataset(instance, body),
        (operationId) => {
          applyOptimisticDatasetAdd(queryClient, instance.id, body, operationId);

          return null;
        },
        // Offline, the cached list stands in for the server's name check.
        () => rejectKnownDatasetName(queryClient, instance.id, body),
      );
    },
    onSuccess: async (outcome) => {
      if (!instance || outcome.queued) return;
      await queryClient.invalidateQueries({
        queryKey: phoenixSessionQueryKeys.datasets(instance.id),
      });
    },
  });
}

export function useWritePhoenixSessionNote(
  instance: PhoenixInstance | undefined,
  projectId: string | undefined,
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: SessionNoteWrite): Promise<WriteOutcome<{ id: string }>> => {
      if (!instance || !projectId) throw new Error('Phoenix project not found.');

      const note: SessionNoteWrite = {
        identifier: input.identifier.trim(),
        note: input.note.trim(),
        sessionId: input.sessionId.trim(),
      };

      return sendOrQueue(
        instance.id,
        { kind: 'sessionNote', instanceId: instance.id, projectId, payload: note },
        () => writeSessionNote(instance, input),
        (operationId) => {
          applyOptimisticAnnotations(
            queryClient,
            instance.id,
            projectId,
            [
              {
                annotator_kind: 'HUMAN',
                identifier: note.identifier,
                name: 'note',
                result: { explanation: note.note },
                session_id: note.sessionId,
              },
            ],
            operationId,
          );

          return null;
        },
      );
    },
    onSuccess: async (outcome, input) => {
      if (!instance || !projectId || outcome.queued) return;
      await invalidateSessionAnnotations(queryClient, instance.id, projectId, [input.sessionId]);
    },
  });
}

/**
 * A write's result: sent now with the server's answer, or queued on the
 * device to upload when the server is back. A queued annotation config
 * carries its optimistic stand-in; other queued writes have no value.
 */
export type WriteOutcome<T> =
  | { queued: false; value: T }
  | { queued: true; operationId: string; value: T | null };

/**
 * Sends a write, or queues it when its server is offline or the request
 * never reaches the server. Queued changes already waiting go first, so a
 * newer write never lands before an older one; then the cache is updated
 * optimistically and replay's invalidation brings back the server's truth.
 */
async function sendOrQueue<T>(
  instanceId: string,
  draft: OutboxDraft,
  send: () => Promise<T>,
  optimistic: (operationId: string) => T | null,
  checkQueueable?: () => void,
): Promise<WriteOutcome<T>> {
  const queue = (): WriteOutcome<T> => {
    checkQueueable?.();

    const operation = enqueue(draft);

    return { queued: true, operationId: operation.id, value: optimistic(operation.id) };
  };

  if (instanceReachability(instanceId) !== 'offline' && hasUnsentChanges(instanceId)) {
    await flushInstance(instanceId);
  }

  if (instanceReachability(instanceId) === 'offline' || hasUnsentChanges(instanceId)) {
    return queue();
  }

  try {
    return { queued: false, value: await send() };
  } catch (error) {
    if (error instanceof Error && isOfflineError(error)) return queue();
    throw error;
  }
}

const PendingIdPrefix = 'pending:';

/** Whether a cached record is an optimistic stand-in for a queued change. */
export function isPendingRecordId(id: string): boolean {
  return id.startsWith(PendingIdPrefix);
}

/**
 * Shows queued annotations (and notes, which are annotations named `note`) in
 * every cached annotation batch that covers their session and name, replacing
 * the current viewer's earlier value just as the server's upsert will.
 */
function applyOptimisticAnnotations(
  queryClient: QueryClient,
  instanceId: string,
  projectId: string,
  annotations: readonly SessionAnnotationData[],
  operationId: string,
) {
  const viewer = queryClient.getQueryData<PhoenixViewer>(phoenixQueryKeys.viewer(instanceId));
  const userId = viewer && viewer.auth_method !== 'ANONYMOUS' ? viewer.id : null;
  const now = new Date().toISOString();
  const prefix = phoenixSessionQueryKeys.annotations(instanceId, projectId);

  const pending: SessionAnnotation[] = annotations.map((annotation, index) => ({
    annotator_kind: annotation.annotator_kind,
    created_at: now,
    id: `${PendingIdPrefix}${operationId}:${index}`,
    identifier: annotation.identifier ?? '',
    metadata: annotation.metadata ?? null,
    name: annotation.name,
    result: annotation.result ?? null,
    session_id: annotation.session_id,
    source: 'API',
    updated_at: now,
    user_id: userId,
  }));

  for (const [queryKey, cached] of queryClient.getQueriesData<SessionAnnotation[]>({
    queryKey: prefix,
  })) {
    const sessionIds = queryKey[prefix.length];
    const names = queryKey[prefix.length + 1];

    if (!isJsonArray(sessionIds) || !isJsonArray(names)) continue;

    const covered = pending.filter(
      (annotation) => sessionIds.includes(annotation.session_id) && names.includes(annotation.name),
    );

    if (covered.length === 0) continue;

    // A list never fetched (the queue changed while offline) starts empty, so
    // the queued review still shows; the next fetch replaces it.
    const kept = (cached ?? []).filter(
      (existing) =>
        !covered.some(
          (annotation) =>
            annotation.session_id === existing.session_id &&
            annotation.name === existing.name &&
            annotation.identifier === existing.identifier &&
            annotation.user_id === existing.user_id,
        ),
    );

    queryClient.setQueryData<SessionAnnotation[]>(queryKey, [...kept, ...covered]);
    // The offline copy must show the queued review after a relaunch too.
    void persistQueryNow(queryKey);
  }
}

function addOptimisticAnnotationConfig(
  queryClient: QueryClient,
  instanceId: string,
  projectId: string,
  data: AnnotationConfigCreateData,
  operationId: string,
): SessionAnnotationConfig {
  const config: SessionAnnotationConfig = { ...data, id: `${PendingIdPrefix}${operationId}` };

  const queryKey = phoenixSessionQueryKeys.annotationConfigs(instanceId, projectId);

  queryClient.setQueryData<SessionAnnotationConfig[]>(queryKey, (current) => [
    ...(current ?? []),
    config,
  ]);
  void persistQueryNow(queryKey);

  return config;
}

/** Rejects a queued create whose name a cached dataset already uses, as the server would. */
function rejectKnownDatasetName(
  queryClient: QueryClient,
  instanceId: string,
  body: SessionDatasetUploadBody,
) {
  if (body.action !== 'create') return;

  const datasets = queryClient.getQueryData<DatasetSummary[]>(
    phoenixSessionQueryKeys.datasets(instanceId),
  );

  if (datasets?.some((dataset) => dataset.name === body.name)) {
    throw new SessionReviewValidationError([
      {
        field: 'datasetName',
        message: `A dataset named “${body.name}” already exists. Append to it or choose another name.`,
      },
    ]);
  }
}

/** A queued create appears in the dataset list; a queued append bumps its count. */
function applyOptimisticDatasetAdd(
  queryClient: QueryClient,
  instanceId: string,
  body: SessionDatasetUploadBody,
  operationId: string,
) {
  const now = new Date().toISOString();
  const added = body.span_ids.length;

  queryClient.setQueryData<DatasetSummary[]>(
    phoenixSessionQueryKeys.datasets(instanceId),
    (current) => {
      const datasets = current ?? [];

      if (datasets.some((dataset) => dataset.name === body.name)) {
        return datasets.map((dataset) =>
          dataset.name === body.name
            ? { ...dataset, example_count: dataset.example_count + added, updated_at: now }
            : dataset,
        );
      }

      const created: DatasetSummary = {
        created_at: now,
        description: body.description ?? null,
        example_count: added,
        id: `${PendingIdPrefix}${operationId}`,
        metadata: {},
        name: body.name,
        updated_at: now,
      };

      return [...datasets, created];
    },
  );
  void persistQueryNow(phoenixSessionQueryKeys.datasets(instanceId));
}

function invalidateAnnotationConfigs(
  queryClient: QueryClient,
  instanceId: string,
  projectId: string,
) {
  return queryClient.invalidateQueries({
    queryKey: phoenixSessionQueryKeys.annotationConfigs(instanceId, projectId),
  });
}

function invalidateSessionAnnotations(
  queryClient: QueryClient,
  instanceId: string,
  projectId: string,
  sessionIds: readonly string[],
) {
  return Promise.all([
    queryClient.invalidateQueries({
      queryKey: phoenixSessionQueryKeys.annotations(instanceId, projectId),
    }),
    ...sessionIds.map((sessionId) =>
      queryClient.invalidateQueries({
        queryKey: phoenixSessionQueryKeys.detail(instanceId, projectId, sessionId),
      }),
    ),
  ]);
}

/**
 * Refreshes what a replayed change affects, replacing its optimistic stand-in
 * with the server's record. Not awaited by replay, so a slow refetch never
 * holds up the next queued change.
 */
export function invalidateAfterReplay(queryClient: QueryClient, operation: OutboxOperation) {
  const { instanceId } = operation;

  switch (operation.kind) {
    case 'sessionAnnotations':
      return invalidateSessionAnnotations(queryClient, instanceId, operation.projectId, [
        ...new Set(operation.payload.annotations.map((annotation) => annotation.session_id)),
      ]);

    case 'sessionAnnotation':
      return invalidateSessionAnnotations(queryClient, instanceId, operation.projectId, [
        operation.payload.annotation.session_id,
      ]);

    case 'sessionNote':
      return invalidateSessionAnnotations(queryClient, instanceId, operation.projectId, [
        operation.payload.sessionId,
      ]);

    case 'addSessionToDataset':
      return queryClient.invalidateQueries({
        queryKey: phoenixSessionQueryKeys.datasets(instanceId),
      });

    case 'createAnnotationConfig':
      return invalidateAnnotationConfigs(queryClient, instanceId, operation.projectId);
  }
}

/**
 * Takes a discarded change's optimistic stand-ins back out of the cache, then
 * refreshes what it touched so a reachable server restores its own truth.
 */
export function revertQueuedChange(queryClient: QueryClient, operation: OutboxOperation) {
  const standIn = `${PendingIdPrefix}${operation.id}`;
  const isStandIn = (id: string) => id === standIn || id.startsWith(`${standIn}:`);

  if (operation.kind === 'createAnnotationConfig') {
    queryClient.setQueryData<SessionAnnotationConfig[]>(
      phoenixSessionQueryKeys.annotationConfigs(operation.instanceId, operation.projectId),
      (current) => current?.filter((config) => !isStandIn(config.id)),
    );
  } else if (operation.kind === 'addSessionToDataset') {
    queryClient.setQueryData<DatasetSummary[]>(
      phoenixSessionQueryKeys.datasets(operation.instanceId),
      (current) => current?.filter((dataset) => !isStandIn(dataset.id)),
    );
  } else {
    queryClient.setQueriesData<SessionAnnotation[]>(
      { queryKey: phoenixSessionQueryKeys.annotations(operation.instanceId, operation.projectId) },
      (current) => current?.filter((annotation) => !isStandIn(annotation.id)),
    );
  }

  return invalidateAfterReplay(queryClient, operation);
}
