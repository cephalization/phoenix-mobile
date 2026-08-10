import { useInfiniteQuery, useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  addSessionToDataset,
  createProjectAnnotationConfig,
  createSessionAnnotationBatches,
  fetchDatasets,
  fetchProjectAnnotationConfigs,
  fetchSession,
  fetchSessionAnnotations,
  fetchSessionPage,
  fetchSessionPxiNotes,
  fetchSessionTurns,
  writeSessionAnnotation,
  writeSessionAnnotations,
  writeSessionNote,
} from '@/features/session-review/api';
import type {
  AnnotationConfigWrite,
  SessionAnnotationWrite,
  SessionAnnotationsWrite,
  SessionData,
  SessionDatasetWrite,
  SessionNoteWrite,
  SessionTurn,
} from '@/features/session-review/types';
import { phoenixQueryKeys } from '@/hooks/use-phoenix-data';
import type { PhoenixInstance } from '@/types/instance';

const missing = 'missing';

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
    annotationNames: readonly string[]
  ) => [
    ...phoenixSessionQueryKeys.annotations(instanceId, projectId),
    [...sessionIds].sort(),
    [...annotationNames].sort(),
  ] as const,
  datasets: (instanceId: string) =>
    [...phoenixQueryKeys.instance(instanceId), 'datasets'] as const,
  pxiNotes: (instanceId: string, projectId: string, sessionId: string) =>
    [...phoenixSessionQueryKeys.project(instanceId, projectId), 'pxi-notes', sessionId] as const,
};

export function usePhoenixProjectSessions(
  instance: PhoenixInstance | undefined,
  projectId: string | undefined
) {
  return useInfiniteQuery({
    queryKey: phoenixSessionQueryKeys.list(instance?.id ?? missing, projectId ?? missing),
    queryFn: ({ pageParam }) => {
      if (!instance || !projectId) throw new Error('Phoenix project not found.');
      return fetchSessionPage(instance, projectId, pageParam);
    },
    initialPageParam: null as string | null,
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
  sessionIdentifier: string | undefined
) {
  return useQuery({
    queryKey: phoenixSessionQueryKeys.detail(
      instance?.id ?? missing,
      projectId ?? missing,
      sessionIdentifier ?? missing
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
  session: SessionData | undefined
) {
  return useQuery({
    queryKey: phoenixSessionQueryKeys.turns(
      instance?.id ?? missing,
      projectId ?? missing,
      session
        ? `${session.session_id}:${session.traces.map((trace) => trace.trace_id).sort().join(',')}`
        : missing
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
  projectId: string | undefined
) {
  return useQuery({
    queryKey: phoenixSessionQueryKeys.annotationConfigs(instance?.id ?? missing, projectId ?? missing),
    queryFn: () => {
      if (!instance || !projectId) throw new Error('Phoenix project not found.');
      return fetchProjectAnnotationConfigs(instance, projectId);
    },
    enabled: Boolean(instance && projectId),
  });
}

export function useCreatePhoenixAnnotationConfig(
  instance: PhoenixInstance | undefined,
  projectId: string | undefined
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: AnnotationConfigWrite) => {
      if (!instance || !projectId) throw new Error('Phoenix project not found.');
      return createProjectAnnotationConfig(instance, projectId, input);
    },
    onSuccess: async () => {
      if (!instance || !projectId) return;
      await queryClient.invalidateQueries({
        queryKey: phoenixSessionQueryKeys.annotationConfigs(instance.id, projectId),
      });
    },
  });
}

export function usePhoenixSessionPxiNotes(
  instance: PhoenixInstance | undefined,
  projectId: string | undefined,
  sessionId: string | undefined,
  turns: SessionTurn[] | undefined
) {
  const spanIds = (turns ?? [])
    .flatMap((turn) => (turn.rootSpan ? [turn.rootSpan.context.span_id] : []))
    .sort();
  return useQuery({
    queryKey: [
      ...phoenixSessionQueryKeys.pxiNotes(
        instance?.id ?? missing,
        projectId ?? missing,
        sessionId ?? missing
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
  annotationNames: readonly string[]
) {
  const batches = createSessionAnnotationBatches(sessionIdPages);
  const names = [...new Set(annotationNames.map((name) => name.trim()).filter(Boolean))];
  const enabled = Boolean(instance && projectId && batches.length > 0 && names.length > 0);
  const queries = useQueries({
    queries: batches.map((sessionIds) => ({
      queryKey: phoenixSessionQueryKeys.annotationsForSessions(
        instance?.id ?? missing,
        projectId ?? missing,
        sessionIds,
        names
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
  projectId: string | undefined
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: SessionAnnotationWrite) => {
      if (!instance || !projectId) throw new Error('Phoenix project not found.');
      return writeSessionAnnotation(instance, input);
    },
    onSuccess: async (_result, input) => {
      if (!instance || !projectId) return;
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: phoenixSessionQueryKeys.annotations(instance.id, projectId),
        }),
        queryClient.invalidateQueries({
          queryKey: phoenixSessionQueryKeys.detail(instance.id, projectId, input.sessionId),
        }),
      ]);
    },
  });
}

export function useWritePhoenixSessionAnnotations(
  instance: PhoenixInstance | undefined,
  projectId: string | undefined
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: SessionAnnotationsWrite) => {
      if (!instance || !projectId) throw new Error('Phoenix project not found.');
      return writeSessionAnnotations(instance, input);
    },
    onSuccess: async () => {
      if (!instance || !projectId) return;
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
    mutationFn: (input: SessionDatasetWrite) => {
      if (!instance) throw new Error('Phoenix instance not found.');
      return addSessionToDataset(instance, input);
    },
    onSuccess: async () => {
      if (!instance) return;
      await queryClient.invalidateQueries({
        queryKey: phoenixSessionQueryKeys.datasets(instance.id),
      });
    },
  });
}

export function useWritePhoenixSessionNote(
  instance: PhoenixInstance | undefined,
  projectId: string | undefined
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: SessionNoteWrite) => {
      if (!instance || !projectId) throw new Error('Phoenix project not found.');
      return writeSessionNote(instance, input);
    },
    onSuccess: async (_result, input) => {
      if (!instance || !projectId) return;
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: phoenixSessionQueryKeys.annotations(instance.id, projectId),
        }),
        queryClient.invalidateQueries({
          queryKey: phoenixSessionQueryKeys.detail(instance.id, projectId, input.sessionId),
        }),
      ]);
    },
  });
}
