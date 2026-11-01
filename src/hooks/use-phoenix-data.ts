import type { Types } from '@arizeai/phoenix-client';
import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { PhoenixAuthError } from '@/features/auth/oauth';
import { compareVersions, getCachedServerVersion } from '@/features/session-review/api';
import { isNetworkFailure } from '@/features/offline/reachability';
import { inputExcerpt } from '@/features/traces/excerpt';
import { combineTraceFilters, normalizeTraceFilter } from '@/features/traces/filter';
import {
  fetchTraceFilterVocabulary,
  TraceFilterExpressionError,
  TraceFilterExpressionsMinimum,
  validateTraceFilterCondition,
} from '@/features/traces/filter-api';
import { isJsonObject } from '@/lib/json';
import { createPhoenixClient } from '@/lib/phoenix';
import type { PhoenixInstance } from '@/types/instance';

export type PhoenixProject = Types['V1']['components']['schemas']['Project'];

export type PhoenixSpan = Types['V1']['components']['schemas']['Span'];

export type PhoenixViewer = Types['V1']['components']['schemas']['GetViewerResponseBody']['data'];

type PhoenixTrace = Types['V1']['components']['schemas']['TraceData'];

export type PhoenixTraceFilter = 'recent' | 'errors' | 'slowest';

export type PhoenixTraceRange = {
  cacheKey: string;
  endTime: string;
  startTime: string;
};

export type PhoenixTraceListItem = {
  endTime: string;
  id: string;
  /** The root span's input on one line, when it has readable text. */
  inputExcerpt: string | null;
  latencyMs: number;
  name: string;
  spanKind: string;
  startTime: string;
  statusCode: string;
  statusMessage: string | null;
  tokenCountTotal: number | null;
  traceId: string;
};

export type PhoenixTraceSummary = {
  errorCount: number;
  medianLatencyMs: number | null;
  tokenCountTotal: number | null;
  traceCount: number;
};

type PhoenixTracePage = {
  items: PhoenixTraceListItem[];
  nextCursor: string | null;
};

type PhoenixTracesResponse = {
  data?: {
    data: PhoenixTrace[];
    next_cursor: string | null;
  };
  error?: string;
  response: Response;
};

type PhoenixSpansResponse = {
  data?: {
    data: PhoenixSpan[];
    next_cursor: string | null;
  };
};

const TRACE_PAGE_SIZE = 30;

// The trace list accepts up to 1000 rows per page; summaries only need slim span rows.
const TRACE_SUMMARY_PAGE_SIZE = 1000;

// The errors feed's server-side definition, AND-combined with the user's filter.
const ERRORS_FILTER = 'error_count > 0';

const TRACE_FILTER_VALIDATION_DEBOUNCE_MS = 250;
const initialTraceCursor: string | null = null;

export const phoenixQueryKeys = {
  all: ['phoenix'] as const,
  instance: (instanceId: string) => [...phoenixQueryKeys.all, 'instance', instanceId] as const,
  projects: (instanceId: string) => [...phoenixQueryKeys.instance(instanceId), 'projects'] as const,
  traceSummary: (
    instanceId: string,
    projectId: string,
    range: PhoenixTraceRange,
    expression: string | null,
  ) =>
    [
      ...phoenixQueryKeys.instance(instanceId),
      'project',
      projectId,
      'trace-summary',
      range.cacheKey,
      expression,
    ] as const,
  traces: (
    instanceId: string,
    projectId: string,
    filter: PhoenixTraceFilter,
    range: PhoenixTraceRange,
    expression: string | null,
  ) =>
    [
      ...phoenixQueryKeys.instance(instanceId),
      'project',
      projectId,
      'traces',
      filter,
      range.cacheKey,
      expression,
    ] as const,
  traceFilterValidation: (instanceId: string, projectId: string, condition: string) =>
    [
      ...phoenixQueryKeys.instance(instanceId),
      'project',
      projectId,
      'trace-filter-validation',
      condition,
    ] as const,
  traceFilterVocabulary: (instanceId: string, projectId: string, rangeKey: string) =>
    [
      ...phoenixQueryKeys.instance(instanceId),
      'project',
      projectId,
      'trace-filter-vocabulary',
      rangeKey,
    ] as const,
  trace: (instanceId: string, projectId: string, traceId: string) =>
    [...phoenixQueryKeys.instance(instanceId), 'project', projectId, 'trace', traceId] as const,
  version: (instanceId: string) => [...phoenixQueryKeys.instance(instanceId), 'version'] as const,
  viewer: (instanceId: string) => [...phoenixQueryKeys.instance(instanceId), 'viewer'] as const,
};

export function usePhoenixVersion(instance: PhoenixInstance | undefined) {
  return useQuery({
    queryKey: phoenixQueryKeys.version(instance?.id ?? 'missing'),
    queryFn: async () => {
      if (!instance) throw new Error('Phoenix instance not found.');
      const version = await getCachedServerVersion(instance, await createPhoenixClient(instance));

      return version.join('.');
    },
    enabled: Boolean(instance),
  });
}

export function usePhoenixProjects(instance: PhoenixInstance | undefined) {
  return useQuery({
    queryKey: phoenixQueryKeys.projects(instance?.id ?? 'missing'),
    queryFn: async (): Promise<PhoenixProject[]> => {
      if (!instance) throw new Error('Phoenix instance not found.');

      const response = await (
        await createPhoenixClient(instance)
      ).GET('/v1/projects', {
        params: {
          query: {
            include_dataset_evaluator_projects: false,
            include_experiment_projects: false,
            limit: 100,
          },
        },
      });

      if (!response.data) throw new Error('Phoenix returned an empty projects response.');

      return response.data.data;
    },
    enabled: Boolean(instance),
  });
}

export function usePhoenixViewer(instance: PhoenixInstance | undefined) {
  return useQuery({
    queryKey: phoenixQueryKeys.viewer(instance?.id ?? 'missing'),
    queryFn: async (): Promise<PhoenixViewer> => {
      if (!instance) throw new Error('Phoenix instance not found.');
      const response = await (await createPhoenixClient(instance)).GET('/v1/user');

      if (!response.data) throw new Error('Phoenix returned an empty user response.');

      return response.data.data;
    },
    enabled: Boolean(instance),
  });
}

/**
 * The traces list. `expression` is the user's trace filter DSL condition (or
 * null); it narrows every feed and is AND-combined with the errors feed's own
 * condition. An expression the server rejects throws `TraceFilterExpressionError`.
 */
export function usePhoenixProjectTraces(
  instance: PhoenixInstance | undefined,
  projectId: string | undefined,
  filter: PhoenixTraceFilter,
  range: PhoenixTraceRange,
  expression: string | null = null,
) {
  return useInfiniteQuery({
    queryKey: phoenixQueryKeys.traces(
      instance?.id ?? 'missing',
      projectId ?? 'missing',
      filter,
      range,
      expression,
    ),
    queryFn: async ({ pageParam }): Promise<PhoenixTracePage> => {
      if (!instance || !projectId) throw new Error('Phoenix project not found.');
      const client = await createPhoenixClient(instance);

      const serverVersion = await getCachedServerVersion(instance, client);

      const supportsFilterExpressions =
        compareVersions(serverVersion, TraceFilterExpressionsMinimum) >= 0;

      if (expression && !supportsFilterExpressions) throw unsupportedFilterError();

      if (filter === 'errors' && !supportsFilterExpressions) {
        // Pre-20.12 fallback: only root-span errors are visible without the
        // trace filter DSL, so page errored root spans directly.
        const response = await client.GET('/v1/projects/{project_identifier}/spans', {
          params: {
            path: { project_identifier: projectId },
            query: {
              cursor: pageParam,
              end_time: range.endTime,
              limit: TRACE_PAGE_SIZE,
              parent_id: 'null',
              start_time: range.startTime,
              status_code: ['ERROR'],
            },
          },
        });

        if (!response.data) throw new Error('Phoenix could not load error traces.');

        return {
          items: response.data.data.map(traceItemFromRootSpan),
          nextCursor: response.data.next_cursor,
        };
      }

      const tracesResponse = await client.GET('/v1/projects/{project_identifier}/traces', {
        params: {
          path: { project_identifier: projectId },
          query: {
            cursor: pageParam,
            end_time: range.endTime,
            // The errors feed matches the Phoenix UI's error indicator: any
            // span in the trace errored.
            filter: combineTraceFilters([filter === 'errors' ? ERRORS_FILTER : null, expression]),
            include_spans: false,
            limit: TRACE_PAGE_SIZE,
            order: 'desc',
            sort: filter === 'slowest' ? 'latency_ms' : 'start_time',
            start_time: range.startTime,
          },
        },
      });

      if (!tracesResponse.data) {
        throw traceListError(tracesResponse, 'Phoenix could not load traces.');
      }

      const traces = tracesResponse.data.data;
      const traceIds = traces.map((trace) => trace.trace_id);
      let rootSpans: PhoenixSpan[] = [];

      if (traceIds.length > 0) {
        const spansResponse = await client.GET('/v1/projects/{project_identifier}/spans', {
          params: {
            path: { project_identifier: projectId },
            query: {
              limit: TRACE_PAGE_SIZE,
              parent_id: 'null',
              trace_id: traceIds,
            },
          },
        });

        if (!spansResponse.data) throw new Error('Phoenix could not load trace summaries.');
        rootSpans = spansResponse.data.data;
      }

      const rootsByTraceId = new Map(rootSpans.map((span) => [span.context.trace_id, span]));

      return {
        items: traces.map((trace) =>
          traceItemFromSummary(trace, rootsByTraceId.get(trace.trace_id)),
        ),
        nextCursor: tracesResponse.data.next_cursor,
      };
    },
    initialPageParam: initialTraceCursor,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: Boolean(instance && projectId),
    retry: retryUnlessRejected,
  });
}

/** Range statistics for the traces the user's filter (if any) keeps. */
export function usePhoenixProjectTraceSummary(
  instance: PhoenixInstance | undefined,
  projectId: string | undefined,
  range: PhoenixTraceRange,
  expression: string | null = null,
) {
  return useQuery({
    queryKey: phoenixQueryKeys.traceSummary(
      instance?.id ?? 'missing',
      projectId ?? 'missing',
      range,
      expression,
    ),
    queryFn: async (): Promise<PhoenixTraceSummary> => {
      if (!instance || !projectId) throw new Error('Phoenix project not found.');
      const client = await createPhoenixClient(instance);

      if (
        expression &&
        compareVersions(
          await getCachedServerVersion(instance, client),
          TraceFilterExpressionsMinimum,
        ) < 0
      ) {
        throw unsupportedFilterError();
      }

      const latencies: number[] = [];
      let cursor: string | null = null;
      let errorCount = 0;
      let tokenCountTotal = 0;
      let hasTokenCounts = false;

      for (;;) {
        const tracesResponse: PhoenixTracesResponse = await client.GET(
          '/v1/projects/{project_identifier}/traces',
          {
            params: {
              path: { project_identifier: projectId },
              query: {
                cursor,
                end_time: range.endTime,
                filter: expression ?? undefined,
                // Slim per-span rows (id, kind, status, timing) ride along with
                // each trace, so error counts need no second spans request.
                include_spans: true,
                limit: TRACE_SUMMARY_PAGE_SIZE,
                order: 'desc',
                sort: 'start_time',
                start_time: range.startTime,
              },
            },
          },
        );

        if (!tracesResponse.data) {
          throw traceListError(tracesResponse, 'Phoenix could not load trace statistics.');
        }

        const traces = tracesResponse.data.data;

        errorCount += traces.filter((trace) =>
          (trace.spans ?? []).some((span) => span.status_code === 'ERROR'),
        ).length;

        for (const trace of traces) {
          latencies.push(durationMs(trace.start_time, trace.end_time));

          if (trace.token_count_total != null) {
            hasTokenCounts = true;
            tokenCountTotal += trace.token_count_total;
          }
        }

        const nextCursor = tracesResponse.data.next_cursor;

        if (!nextCursor || nextCursor === cursor) break;
        cursor = nextCursor;
      }

      latencies.sort((a, b) => a - b);
      const middle = Math.floor(latencies.length / 2);

      const medianLatencyMs =
        latencies.length === 0
          ? null
          : latencies.length % 2 === 0
            ? (latencies[middle - 1] + latencies[middle]) / 2
            : latencies[middle];

      return {
        errorCount,
        medianLatencyMs,
        tokenCountTotal: hasTokenCounts ? tokenCountTotal : null,
        traceCount: latencies.length,
      };
    },
    enabled: Boolean(instance && projectId),
    retry: retryUnlessRejected,
  });
}

export function usePhoenixTrace(
  instance: PhoenixInstance | undefined,
  projectId: string | undefined,
  traceId: string | undefined,
) {
  return useQuery({
    queryKey: phoenixQueryKeys.trace(
      instance?.id ?? 'missing',
      projectId ?? 'missing',
      traceId ?? 'missing',
    ),
    queryFn: async (): Promise<PhoenixSpan[]> => {
      if (!instance || !projectId || !traceId) throw new Error('Phoenix trace not found.');
      const client = await createPhoenixClient(instance);
      const spans: PhoenixSpan[] = [];
      let cursor: string | null = null;

      for (;;) {
        const response: PhoenixSpansResponse = await client.GET(
          '/v1/projects/{project_identifier}/spans',
          {
            params: {
              path: { project_identifier: projectId },
              query: {
                cursor,
                limit: 100,
                trace_id: [traceId],
              },
            },
          },
        );

        if (!response.data) throw new Error('Phoenix could not load this trace.');
        spans.push(...response.data.data);

        const nextCursor: string | null = response.data.next_cursor;

        if (!nextCursor || nextCursor === cursor) break;
        cursor = nextCursor;
      }

      return spans;
    },
    enabled: Boolean(instance && projectId && traceId),
  });
}

/**
 * The trace list answers a rejected `filter` with HTTP 400 and the
 * compiler's message as plain text; surface that rather than a generic failure.
 */
function traceListError(response: PhoenixTracesResponse, fallback: string) {
  const message = response.error?.trim();

  if (response.response.status === 400 && message) return new TraceFilterExpressionError(message);

  return new Error(fallback);
}

/** The app's retry policy, minus a filter the server rejected: asking again cannot help. */
function retryUnlessRejected(failureCount: number, error: Error) {
  return (
    !(error instanceof TraceFilterExpressionError) &&
    !(error instanceof PhoenixAuthError) &&
    !isNetworkFailure(error) &&
    failureCount < 1
  );
}

function unsupportedFilterError() {
  return new TraceFilterExpressionError(
    'This Phoenix server does not support trace filters. Update it to 20.12 or later.',
  );
}

/** Whether the instance runs at least `minimum`; undefined until its version loads. */
export function usePhoenixVersionAtLeast(
  instance: PhoenixInstance | undefined,
  minimum: readonly number[],
) {
  const version = usePhoenixVersion(instance);

  if (!version.data) return undefined;

  return compareVersions(version.data.split('.').map(Number), minimum) >= 0;
}

export type TraceFilterValidation = {
  /** `unavailable`: the server could not judge it (no validator or a network failure). */
  state: 'idle' | 'checking' | 'valid' | 'invalid' | 'unavailable';
  message: string | null;
  warnings: string[];
};

/**
 * Validates a draft trace filter on the server as the user types, 250 ms
 * after the last keystroke (Phoenix's `VALIDATION_DEBOUNCE_MS`).
 */
export function useTraceFilterValidation(
  instance: PhoenixInstance | undefined,
  projectId: string | undefined,
  expression: string,
): TraceFilterValidation {
  const condition = normalizeTraceFilter(expression);
  const [debounced, setDebounced] = useState(condition);

  useEffect(() => {
    const timeout = setTimeout(() => setDebounced(condition), TRACE_FILTER_VALIDATION_DEBOUNCE_MS);

    return () => clearTimeout(timeout);
  }, [condition]);

  const query = useQuery({
    queryKey: phoenixQueryKeys.traceFilterValidation(
      instance?.id ?? 'missing',
      projectId ?? 'missing',
      debounced,
    ),
    queryFn: ({ signal }) => {
      if (!instance || !projectId) throw new Error('Phoenix project not found.');

      return validateTraceFilterCondition(instance, projectId, debounced, signal);
    },
    enabled: Boolean(instance && projectId) && debounced.length > 0,
    retry: false,
    staleTime: 5 * 60_000,
  });

  if (condition.length === 0) return { state: 'idle', message: null, warnings: [] };

  if (debounced !== condition || query.isPending) {
    return { state: 'checking', message: null, warnings: [] };
  }

  if (query.isError) return { state: 'unavailable', message: query.error.message, warnings: [] };

  if (query.data === null) return { state: 'unavailable', message: null, warnings: [] };

  return query.data.isValid
    ? { state: 'valid', message: null, warnings: query.data.warnings }
    : {
        state: 'invalid',
        message: query.data.errorMessage ?? 'This filter is not valid.',
        warnings: query.data.warnings,
      };
}

/**
 * The project's trace filter vocabulary for completions and the AI prompt.
 * Empty on servers without `traceFilterVocabulary`.
 */
export function useTraceFilterVocabulary(
  instance: PhoenixInstance | undefined,
  projectId: string | undefined,
  range: PhoenixTraceRange,
) {
  return useQuery({
    queryKey: phoenixQueryKeys.traceFilterVocabulary(
      instance?.id ?? 'missing',
      projectId ?? 'missing',
      range.cacheKey,
    ),
    queryFn: ({ signal }) => {
      if (!instance || !projectId) throw new Error('Phoenix project not found.');

      return fetchTraceFilterVocabulary(instance, projectId, range, signal);
    },
    enabled: Boolean(instance && projectId),
    placeholderData: keepPreviousData,
    staleTime: 5 * 60_000,
  });
}

function traceItemFromSummary(
  trace: PhoenixTrace,
  rootSpan: PhoenixSpan | undefined,
): PhoenixTraceListItem {
  return {
    endTime: trace.end_time,
    id: trace.id,
    inputExcerpt: rootSpan ? rootInputExcerpt(rootSpan) : null,
    latencyMs: durationMs(trace.start_time, trace.end_time),
    name: rootSpan?.name ?? `Trace ${trace.trace_id.slice(-8)}`,
    spanKind: rootSpan?.span_kind ?? 'TRACE',
    startTime: trace.start_time,
    statusCode: rootSpan?.status_code ?? 'UNSET',
    statusMessage: rootSpan?.status_message || null,
    tokenCountTotal: trace.token_count_total ?? null,
    traceId: trace.trace_id,
  };
}

function traceItemFromRootSpan(span: PhoenixSpan): PhoenixTraceListItem {
  return {
    endTime: span.end_time,
    id: span.id ?? span.context.trace_id,
    inputExcerpt: rootInputExcerpt(span),
    latencyMs: durationMs(span.start_time, span.end_time),
    name: span.name,
    spanKind: span.span_kind,
    startTime: span.start_time,
    statusCode: span.status_code,
    statusMessage: span.status_message || null,
    tokenCountTotal: null,
    traceId: span.context.trace_id,
  };
}

function rootInputExcerpt(span: PhoenixSpan) {
  return inputExcerpt(isJsonObject(span.attributes) ? span.attributes['input.value'] : undefined);
}

function durationMs(startTime: string, endTime: string) {
  return Math.max(0, new Date(endTime).getTime() - new Date(startTime).getTime());
}

// Root-span lookups go out in chunks so the trace ID list stays a sane URL length.
const OPENER_CHUNK_SIZE = 40;

/**
 * The opening input of each trace, keyed by trace ID, for titling list rows
 * with what was asked. One root-span request per chunk of traces; the result
 * never changes for a trace, so it is not refetched.
 */
export function usePhoenixTraceOpeners(
  instance: PhoenixInstance | undefined,
  projectId: string | undefined,
  traceIds: string[],
) {
  return useQuery({
    queryKey: [
      ...phoenixQueryKeys.instance(instance?.id ?? 'missing'),
      'trace-openers',
      projectId ?? 'missing',
      traceIds,
    ],
    queryFn: async (): Promise<Record<string, string>> => {
      if (!instance || !projectId) throw new Error('Phoenix project not found.');
      const client = await createPhoenixClient(instance);
      const openers: Record<string, string> = {};

      for (let start = 0; start < traceIds.length; start += OPENER_CHUNK_SIZE) {
        const chunk = traceIds.slice(start, start + OPENER_CHUNK_SIZE);

        const response = await client.GET('/v1/projects/{project_identifier}/spans', {
          params: {
            path: { project_identifier: projectId },
            query: { limit: chunk.length * 2, parent_id: 'null', trace_id: chunk },
          },
        });

        for (const span of response.data?.data ?? []) {
          const excerpt = rootInputExcerpt(span);

          if (excerpt !== null) openers[span.context.trace_id] = excerpt;
        }
      }

      return openers;
    },
    enabled: Boolean(instance && projectId) && traceIds.length > 0,
    placeholderData: keepPreviousData,
    staleTime: Infinity,
  });
}
