import { formatDuration } from '@/lib/format';

import type { ProjectHealth, StatusBin } from './model';
import { formatSpan, type MetricsWindow, recentBinCount } from './window';

/** Why a project needs a look, worst first. */
export type HealthSignal =
  | { kind: 'errors'; summary: string }
  | { kind: 'quiet'; summary: string }
  | { kind: 'slower'; summary: string };

export type StatusTotals = { traces: number; errors: number };

const SignalOrder: Record<HealthSignal['kind'], number> = { errors: 0, quiet: 1, slower: 2 };

/** Errors only count as a spike with enough of them to not be noise. */
const MinimumRecentErrors = 3;
const MinimumErrorRate = 0.05;
const ErrorSpikeFactor = 2;

/** A project must have been busy for its silence to mean anything. */
const MinimumTracesPerBin = 1;
const QuietShare = 0.2;

const SlowerFactor = 1.5;
const MinimumSlowP95Ms = 1000;

/** A p95 from a handful of traces is noise, so both windows need this many. */
const MinimumTracesForLatency = 50;

export function statusTotals(bins: readonly StatusBin[]): StatusTotals {
  let traces = 0;
  let errors = 0;

  for (const bin of bins) {
    traces += bin.ok + bin.errors;
    errors += bin.errors;
  }

  return { traces, errors };
}

export function errorRate(totals: StatusTotals): number | null {
  return totals.traces === 0 ? null : totals.errors / totals.traces;
}

/**
 * The most pressing reason to open a project, or null when it looks normal.
 * Recent bins are compared with the rest of the window and the window before,
 * so a spike in the last few hours shows even when the day's total is calm.
 */
export function assessProject(health: ProjectHealth, window: MetricsWindow): HealthSignal | null {
  const recentCount = Math.min(recentBinCount(window), health.status.length);
  const split = health.status.length - recentCount;
  const recent = statusTotals(health.status.slice(split));
  const earlier = statusTotals(health.status.slice(0, split));
  const span = formatSpan(recentCount * window.binMs);

  const baseline = {
    traces: earlier.traces + health.previous.traces,
    errors: earlier.errors + health.previous.errors,
  };

  const signals: HealthSignal[] = [];
  const recentRate = errorRate(recent);
  const baselineRate = errorRate(baseline) ?? 0;

  if (
    recentRate !== null &&
    recent.errors >= MinimumRecentErrors &&
    recentRate >= MinimumErrorRate &&
    recentRate >= baselineRate * ErrorSpikeFactor
  ) {
    signals.push({
      kind: 'errors',
      summary: `${formatPercent(recentRate)} errors in the last ${span}, usually ${formatPercent(baselineRate)}`,
    });
  }

  const expected = split === 0 ? 0 : (earlier.traces / split) * recentCount;

  if (
    earlier.traces / Math.max(split, 1) >= MinimumTracesPerBin &&
    recent.traces <= expected * QuietShare
  ) {
    signals.push({
      kind: 'quiet',
      summary:
        recent.traces === 0
          ? `No traces in the last ${span}`
          : `Traffic down ${formatPercent(1 - recent.traces / expected)} in the last ${span}`,
    });
  }

  if (
    health.p95 !== null &&
    health.previous.p95 !== null &&
    earlier.traces + recent.traces >= MinimumTracesForLatency &&
    health.previous.traces >= MinimumTracesForLatency &&
    health.p95 >= MinimumSlowP95Ms &&
    health.p95 >= health.previous.p95 * SlowerFactor
  ) {
    signals.push({
      kind: 'slower',
      summary: `p95 ${formatDuration(health.p95)}, was ${formatDuration(health.previous.p95)}`,
    });
  }

  signals.sort((left, right) => SignalOrder[left.kind] - SignalOrder[right.kind]);

  return signals[0] ?? null;
}

/** `6.8%`, `12%`, or `<0.1%`. */
export function formatPercent(fraction: number): string {
  const percent = fraction * 100;

  if (percent === 0) return '0%';

  if (percent < 0.1) return '<0.1%';

  return `${percent < 10 ? percent.toFixed(1) : Math.round(percent)}%`;
}

/** `$0.42`, `$12.80`, `$1.2k`; costs under a cent read `<$0.01`. */
export function formatCost(dollars: number): string {
  if (dollars === 0) return '$0';

  if (dollars < 0.01) return '<$0.01';

  if (dollars < 1000) return `$${dollars.toFixed(2)}`;

  return `$${(dollars / 1000).toFixed(1)}k`;
}
