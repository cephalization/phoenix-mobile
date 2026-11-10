import { phoenixGraphQL } from '@/lib/phoenix-graphql';
import type { PhoenixInstance } from '@/types/instance';

import {
  parseProjectHealth,
  parseProjectOverview,
  type ProjectHealth,
  type ProjectOverview,
} from './model';
import type { MetricsWindow } from './window';

export { MetricsMinimum } from './model';

export type { EvalSeries, ModelCost, ProjectHealth, ProjectOverview, StatusBin } from './model';

const PROJECT_OVERVIEW_QUERY = `
  query ProjectOverviewQuery(
    $id: ID!
    $range: TimeRange!
    $previous: TimeRange!
    $bins: TimeBinConfig!
    $previousBins: TimeBinConfig!
  ) {
    node(id: $id) {
      ... on Project {
        status: traceCountByStatusTimeSeries(timeRange: $range, timeBinConfig: $bins) {
          data { timestamp okCount errorCount }
        }
        previousStatus: traceCountByStatusTimeSeries(timeRange: $previous, timeBinConfig: $previousBins) {
          data { okCount errorCount }
        }
        latency: traceLatencyMsPercentileTimeSeries(timeRange: $range, timeBinConfig: $bins) {
          data { timestamp p50 p95 }
        }
        cost: traceTokenCostTimeSeries(timeRange: $range, timeBinConfig: $bins) {
          data { timestamp totalCost }
        }
        p50: latencyMsQuantile(probability: 0.5, timeRange: $range)
        p95: latencyMsQuantile(probability: 0.95, timeRange: $range)
        previousP95: latencyMsQuantile(probability: 0.95, timeRange: $previous)
        costSummary(timeRange: $range) { total { cost tokens } }
        previousCost: costSummary(timeRange: $previous) { total { cost } }
        topModelsByCost(timeRange: $range) {
          name
          costSummary(projectId: $id, timeRange: $range) { total { cost tokens } }
        }
        spanScores: spanAnnotationScoreTimeSeries(timeRange: $range, timeBinConfig: $bins) {
          data { timestamp scoresWithLabels { label score } }
        }
        traceScores: traceAnnotationScoreTimeSeries(timeRange: $range, timeBinConfig: $bins) {
          data { timestamp scoresWithLabels { label score } }
        }
      }
    }
  }
`;

const HEALTH_FIELDS = `
  status: traceCountByStatusTimeSeries(timeRange: $range, timeBinConfig: $bins) {
    data { timestamp okCount errorCount }
  }
  previousStatus: traceCountByStatusTimeSeries(timeRange: $previous, timeBinConfig: $previousBins) {
    data { okCount errorCount }
  }
  p95: latencyMsQuantile(probability: 0.95, timeRange: $range)
  previousP95: latencyMsQuantile(probability: 0.95, timeRange: $previous)
  costSummary(timeRange: $range) { total { cost } }
`;

/** Projects per health request; each brings several aggregates, so batches stay small. */
const HEALTH_BATCH_SIZE = 20;

export async function fetchProjectOverview(
  instance: PhoenixInstance,
  projectId: string,
  window: MetricsWindow,
  signal?: AbortSignal,
): Promise<ProjectOverview> {
  const data = await phoenixGraphQL(instance, PROJECT_OVERVIEW_QUERY, {
    signal,
    timeoutMs: 20_000,
    variables: { id: projectId, ...windowVariables(window) },
  });

  return parseProjectOverview(data.node ?? null, window);
}

/** Health for every listed project, a few batched GraphQL requests in parallel. */
export async function fetchProjectsHealth(
  instance: PhoenixInstance,
  projectIds: readonly string[],
  window: MetricsWindow,
  signal?: AbortSignal,
): Promise<ProjectHealth[]> {
  const batches: string[][] = [];

  for (let index = 0; index < projectIds.length; index += HEALTH_BATCH_SIZE) {
    batches.push(projectIds.slice(index, index + HEALTH_BATCH_SIZE));
  }

  const results = await Promise.all(
    batches.map(async (ids) => {
      const declarations = ids.map((_, index) => `$p${index}: ID!`).join(', ');

      const selections = ids
        .map(
          (_, index) => `p${index}: node(id: $p${index}) { ... on Project { ${HEALTH_FIELDS} } }`,
        )
        .join('\n');

      const query = `query ProjectsHealthQuery($range: TimeRange!, $previous: TimeRange!, $bins: TimeBinConfig!, $previousBins: TimeBinConfig!, ${declarations}) { ${selections} }`;

      const variables = {
        ...windowVariables(window),
        ...Object.fromEntries(ids.map((id, index) => [`p${index}`, id])),
      };

      const data = await phoenixGraphQL(instance, query, { signal, timeoutMs: 20_000, variables });

      return ids.map((id, index) => parseProjectHealth(id, data[`p${index}`] ?? null, window));
    }),
  );

  return results.flat();
}

function windowVariables(window: MetricsWindow) {
  return {
    range: { start: iso(window.start), end: iso(window.end) },
    previous: { start: iso(window.previousStart), end: iso(window.start) },
    bins: { scale: window.scale, utcOffsetMinutes: window.utcOffsetMinutes },
    // One bin per day is enough to total the comparison window.
    previousBins: { scale: 'DAY', utcOffsetMinutes: window.utcOffsetMinutes },
  };
}

function iso(time: number) {
  return new Date(time).toISOString();
}
