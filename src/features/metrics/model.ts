import { isJsonArray, isJsonNumber, isJsonObject, isJsonString, type JsonValue } from '@/lib/json';

import { binIndex, type MetricsWindow } from './window';

/**
 * Project metrics come from Phoenix's GraphQL time series, the data behind
 * its Metrics page. Every field the app reads exists from Phoenix 11.11.0
 * (`topModelsByCost`); the status, latency, cost, and score series and local
 * time binning date from 11.8 and 11.9.
 */
export const MetricsMinimum = [11, 11, 0] as const;

export type StatusBin = { ok: number; errors: number };

export type LatencyBin = { p50: number | null; p95: number | null };

export type EvalSeries = {
  name: string;
  /** Mean score per bin; null where nothing was scored. */
  scores: (number | null)[];
};

export type ModelCost = { name: string; cost: number; tokens: number };

/** One project's activity across a window, bin by bin, plus the window before it. */
export type ProjectOverview = {
  status: StatusBin[];
  latency: LatencyBin[];
  cost: (number | null)[];
  p50: number | null;
  p95: number | null;
  totalCost: number | null;
  totalTokens: number | null;
  previous: { traces: number; errors: number; p95: number | null; cost: number | null };
  models: ModelCost[];
  evals: EvalSeries[];
};

/** The slice of a project the projects list needs: its pulse and the comparison window. */
export type ProjectHealth = {
  projectId: string;
  status: StatusBin[];
  p95: number | null;
  cost: number | null;
  previous: { traces: number; errors: number; p95: number | null };
};

export function parseProjectOverview(node: JsonValue, window: MetricsWindow): ProjectOverview {
  if (!isJsonObject(node)) throw new Error('Phoenix returned no metrics for this project.');

  const latency: LatencyBin[] = window.bins.map(() => ({ p50: null, p95: null }));

  for (const point of seriesPoints(node.latency)) {
    const index = pointIndex(window, point);

    if (index >= 0) latency[index] = { p50: numberOrNull(point.p50), p95: numberOrNull(point.p95) };
  }

  const cost: (number | null)[] = window.bins.map(() => null);

  for (const point of seriesPoints(node.cost)) {
    const index = pointIndex(window, point);

    if (index >= 0) cost[index] = numberOrNull(point.totalCost);
  }

  const total = costTotal(node.costSummary);

  return {
    status: statusBins(node.status, window),
    latency,
    cost,
    p50: numberOrNull(node.p50),
    p95: numberOrNull(node.p95),
    totalCost: total.cost,
    totalTokens: total.tokens,
    previous: {
      ...statusTotals(node.previousStatus),
      p95: numberOrNull(node.previousP95),
      cost: costTotal(node.previousCost).cost,
    },
    models: modelCosts(node.topModelsByCost),
    evals: [...evalSeries(node.spanScores, window), ...evalSeries(node.traceScores, window)],
  };
}

export function parseProjectHealth(
  projectId: string,
  node: JsonValue,
  window: MetricsWindow,
): ProjectHealth {
  if (!isJsonObject(node)) {
    return {
      projectId,
      status: window.bins.map(() => ({ ok: 0, errors: 0 })),
      p95: null,
      cost: null,
      previous: { traces: 0, errors: 0, p95: null },
    };
  }

  return {
    projectId,
    status: statusBins(node.status, window),
    p95: numberOrNull(node.p95),
    cost: costTotal(node.costSummary).cost,
    previous: { ...statusTotals(node.previousStatus), p95: numberOrNull(node.previousP95) },
  };
}

function statusBins(series: JsonValue | undefined, window: MetricsWindow): StatusBin[] {
  const bins: StatusBin[] = window.bins.map(() => ({ ok: 0, errors: 0 }));

  for (const point of seriesPoints(series)) {
    const index = pointIndex(window, point);

    if (index >= 0) {
      bins[index] = { ok: numberOrZero(point.okCount), errors: numberOrZero(point.errorCount) };
    }
  }

  return bins;
}

function statusTotals(series: JsonValue | undefined) {
  let traces = 0;
  let errors = 0;

  for (const point of seriesPoints(series)) {
    errors += numberOrZero(point.errorCount);
    traces += numberOrZero(point.okCount) + numberOrZero(point.errorCount);
  }

  return { traces, errors };
}

function evalSeries(series: JsonValue | undefined, window: MetricsWindow): EvalSeries[] {
  const byName = new Map<string, (number | null)[]>();

  for (const point of seriesPoints(series)) {
    const index = pointIndex(window, point);

    if (index < 0 || !isJsonArray(point.scoresWithLabels)) continue;

    for (const entry of point.scoresWithLabels) {
      if (!isJsonObject(entry) || !isJsonString(entry.label) || !isJsonNumber(entry.score))
        continue;
      const scores = byName.get(entry.label) ?? window.bins.map(() => null);
      scores[index] = entry.score;
      byName.set(entry.label, scores);
    }
  }

  return [...byName].map(([name, scores]) => ({ name, scores }));
}

function modelCosts(models: JsonValue | undefined): ModelCost[] {
  if (!isJsonArray(models)) return [];

  return models.flatMap((model) => {
    if (!isJsonObject(model) || !isJsonString(model.name)) return [];
    const total = costTotal(model.costSummary);

    return total.cost === null || total.cost <= 0
      ? []
      : [{ name: model.name, cost: total.cost, tokens: total.tokens ?? 0 }];
  });
}

function costTotal(summary: JsonValue | undefined) {
  const total = isJsonObject(summary) && isJsonObject(summary.total) ? summary.total : null;

  return { cost: numberOrNull(total?.cost), tokens: numberOrNull(total?.tokens) };
}

function seriesPoints(series: JsonValue | undefined) {
  if (!isJsonObject(series) || !isJsonArray(series.data)) return [];

  return series.data.filter(isJsonObject);
}

function pointIndex(window: MetricsWindow, point: { timestamp?: JsonValue }) {
  if (!isJsonString(point.timestamp)) return -1;
  const time = Date.parse(point.timestamp);

  return Number.isNaN(time) ? -1 : binIndex(window, time);
}

function numberOrNull(value: JsonValue | undefined): number | null {
  return isJsonNumber(value) ? value : null;
}

function numberOrZero(value: JsonValue | undefined): number {
  return isJsonNumber(value) ? value : 0;
}
