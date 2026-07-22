import type { Types } from '@arizeai/phoenix-client';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';

import { createPhoenixClient } from '@/lib/phoenix';
import type { PhoenixInstance } from '@/types/instance';

export type PhoenixProject = Types['V1']['components']['schemas']['Project'];
type PhoenixSpan = Types['V1']['components']['schemas']['Span'];
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
  latencyMs: number;
  name: string;
  spanKind: string;
  startTime: string;
  statusCode: string;
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
};

const TRACE_PAGE_SIZE = 30;
const TRACE_SUMMARY_PAGE_SIZE = 100;

export const phoenixQueryKeys = {
  all: ['phoenix'] as const,
  instance: (instanceId: string) => [...phoenixQueryKeys.all, 'instance', instanceId] as const,
  projects: (instanceId: string) => [...phoenixQueryKeys.instance(instanceId), 'projects'] as const,
  traceSummary: (instanceId: string, projectId: string, range: PhoenixTraceRange) =>
    [...phoenixQueryKeys.instance(instanceId), 'project', projectId, 'trace-summary', range.cacheKey] as const,
  traces: (instanceId: string, projectId: string, filter: PhoenixTraceFilter, range: PhoenixTraceRange) =>
    [...phoenixQueryKeys.instance(instanceId), 'project', projectId, 'traces', filter, range.cacheKey] as const,
  version: (instanceId: string) => [...phoenixQueryKeys.instance(instanceId), 'version'] as const,
};

export function usePhoenixVersion(instance: PhoenixInstance | undefined) {
  return useQuery({
    queryKey: phoenixQueryKeys.version(instance?.id ?? 'missing'),
    queryFn: async () => {
      if (!instance) throw new Error('Phoenix instance not found.');
      const version = await createPhoenixClient(instance).getServerVersion();
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
      const response = await createPhoenixClient(instance).GET('/v1/projects', {
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

export function usePhoenixProjectTraces(
  instance: PhoenixInstance | undefined,
  projectId: string | undefined,
  filter: PhoenixTraceFilter,
  range: PhoenixTraceRange
) {
  return useInfiniteQuery({
    queryKey: phoenixQueryKeys.traces(instance?.id ?? 'missing', projectId ?? 'missing', filter, range),
    queryFn: async ({ pageParam }): Promise<PhoenixTracePage> => {
      if (!instance || !projectId) throw new Error('Phoenix project not found.');
      const client = createPhoenixClient(instance);

      if (filter === 'errors') {
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
             include_spans: false,
             limit: TRACE_PAGE_SIZE,
             order: 'desc',
             sort: filter === 'slowest' ? 'latency_ms' : 'start_time',
             start_time: range.startTime,
          },
        },
      });

      if (!tracesResponse.data) throw new Error('Phoenix could not load traces.');
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
        items: traces.map((trace) => traceItemFromSummary(trace, rootsByTraceId.get(trace.trace_id))),
        nextCursor: tracesResponse.data.next_cursor,
      };
    },
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: Boolean(instance && projectId),
  });
}

export function usePhoenixProjectTraceSummary(
  instance: PhoenixInstance | undefined,
  projectId: string | undefined,
  range: PhoenixTraceRange
) {
  return useQuery({
    queryKey: phoenixQueryKeys.traceSummary(instance?.id ?? 'missing', projectId ?? 'missing', range),
    queryFn: async (): Promise<PhoenixTraceSummary> => {
      if (!instance || !projectId) throw new Error('Phoenix project not found.');
      const client = createPhoenixClient(instance);
      const latencies: number[] = [];
      let cursor: string | null = null;
      let errorCount = 0;
      let tokenCountTotal = 0;
      let hasTokenCounts = false;

      do {
        const tracesResponse: PhoenixTracesResponse = await client.GET('/v1/projects/{project_identifier}/traces', {
          params: {
            path: { project_identifier: projectId },
            query: {
              cursor,
              end_time: range.endTime,
              include_spans: false,
              limit: TRACE_SUMMARY_PAGE_SIZE,
              order: 'desc',
              sort: 'start_time',
              start_time: range.startTime,
            },
          },
        });
        if (!tracesResponse.data) throw new Error('Phoenix could not load trace statistics.');

        const traces = tracesResponse.data.data;
        const traceIds = traces.map((trace) => trace.trace_id);
        if (traceIds.length > 0) {
          const spansResponse = await client.GET('/v1/projects/{project_identifier}/spans', {
            params: {
              path: { project_identifier: projectId },
              query: {
                limit: TRACE_SUMMARY_PAGE_SIZE,
                parent_id: 'null',
                trace_id: traceIds,
              },
            },
          });
          if (!spansResponse.data) throw new Error('Phoenix could not load trace statistics.');
          errorCount += spansResponse.data.data.filter((span) => span.status_code === 'ERROR').length;
        }

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
      } while (true);

      latencies.sort((a, b) => a - b);
      const middle = Math.floor(latencies.length / 2);
      const medianLatencyMs = latencies.length === 0
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
  });
}

function traceItemFromSummary(trace: PhoenixTrace, rootSpan: PhoenixSpan | undefined): PhoenixTraceListItem {
  return {
    endTime: trace.end_time,
    id: trace.id,
    latencyMs: durationMs(trace.start_time, trace.end_time),
    name: rootSpan?.name ?? `Trace ${trace.trace_id.slice(-8)}`,
    spanKind: rootSpan?.span_kind ?? 'TRACE',
    startTime: trace.start_time,
    statusCode: rootSpan?.status_code ?? 'UNSET',
    tokenCountTotal: trace.token_count_total ?? null,
    traceId: trace.trace_id,
  };
}

function traceItemFromRootSpan(span: PhoenixSpan): PhoenixTraceListItem {
  return {
    endTime: span.end_time,
    id: span.id ?? span.context.trace_id,
    latencyMs: durationMs(span.start_time, span.end_time),
    name: span.name,
    spanKind: span.span_kind,
    startTime: span.start_time,
    statusCode: span.status_code,
    tokenCountTotal: null,
    traceId: span.context.trace_id,
  };
}

function durationMs(startTime: string, endTime: string) {
  return Math.max(0, new Date(endTime).getTime() - new Date(startTime).getTime());
}
