import { describe, expect, it } from 'vite-plus/test';

import type { JsonValue } from '@/lib/json';

import {
  parseProjectHealth,
  parseProjectOverview,
  type ProjectHealth,
  type StatusBin,
} from './model';
import { assessProject, formatCost, formatPercent } from './health';
import { overviewKey, useOverviewStore } from './overview-store';
import { binIndex, createMetricsWindow, recentBinCount } from './window';

// 2026-11-10 18:40 UTC, in a UTC-5 zone.
const now = Date.parse('2026-11-10T18:40:00.000Z');
const offset = -300;

function hourly(counts: readonly [number, number][]): StatusBin[] {
  return counts.map(([ok, errors]) => ({ ok, errors }));
}

function health(
  status: StatusBin[],
  previous: ProjectHealth['previous'] = { traces: 0, errors: 0, p95: null },
  p95: number | null = null,
): ProjectHealth {
  return { projectId: 'p', status, p95, cost: null, previous };
}

describe('metrics window', () => {
  it('starts on a local hour and bins the day ending now', () => {
    const window = createMetricsWindow('day', now, offset);

    expect(new Date(window.start).toISOString()).toBe('2026-11-09T18:00:00.000Z');
    expect(window.bins).toHaveLength(25);
    expect(window.end).toBe(now);
    expect(window.previousStart).toBe(window.start - (now - window.start));
    expect(window.scale).toBe('HOUR');
  });

  it('bins a 30-minute zone on its own half hours', () => {
    const window = createMetricsWindow('day', now, 330);

    expect(new Date(window.start).toISOString()).toBe('2026-11-09T18:30:00.000Z');
  });

  it('places server timestamps in their bins and drops those outside', () => {
    const window = createMetricsWindow('day', now, offset);

    expect(binIndex(window, Date.parse('2026-11-09T18:00:00+00:00'))).toBe(0);
    expect(binIndex(window, Date.parse('2026-11-10T18:00:00+00:00'))).toBe(24);
    expect(binIndex(window, Date.parse('2026-11-08T18:00:00+00:00'))).toBe(-1);
  });

  it('compares at least the last three bins', () => {
    expect(recentBinCount(createMetricsWindow('day', now, offset))).toBe(4);
    expect(recentBinCount(createMetricsWindow('week', now, offset))).toBe(22);
  });
});

describe('metrics parsing', () => {
  const window = createMetricsWindow('day', now, offset);

  it('fills missing bins and reads totals, models, and evals', () => {
    const node: JsonValue = {
      status: {
        data: [
          { timestamp: '2026-11-09T18:00:00+00:00', okCount: 10, errorCount: 1 },
          { timestamp: '2026-11-10T18:00:00+00:00', okCount: 4, errorCount: 2 },
        ],
      },
      previousStatus: { data: [{ okCount: 30, errorCount: 3 }] },
      latency: { data: [{ timestamp: '2026-11-10T17:00:00+00:00', p50: 900, p95: null }] },
      cost: { data: [{ timestamp: '2026-11-10T17:00:00+00:00', totalCost: 0.5 }] },
      p50: 800,
      p95: 2400,
      previousP95: 1200,
      costSummary: { total: { cost: 1.25, tokens: 5000 } },
      previousCost: { total: { cost: null } },
      topModelsByCost: [
        { name: 'gpt-4o', costSummary: { total: { cost: 1.2, tokens: 3000 } } },
        { name: 'free-model', costSummary: { total: { cost: 0, tokens: 10 } } },
      ],
      spanScores: {
        data: [
          {
            timestamp: '2026-11-10T16:00:00+00:00',
            scoresWithLabels: [{ label: 'helpfulness', score: 0.7 }],
          },
        ],
      },
      traceScores: { data: [] },
    };

    const overview = parseProjectOverview(node, window);

    expect(overview.status[0]).toEqual({ ok: 10, errors: 1 });
    expect(overview.status[1]).toEqual({ ok: 0, errors: 0 });
    expect(overview.status[24]).toEqual({ ok: 4, errors: 2 });
    expect(overview.latency[23]).toEqual({ p50: 900, p95: null });
    expect(overview.cost[23]).toBe(0.5);
    expect(overview.previous).toEqual({ traces: 33, errors: 3, p95: 1200, cost: null });
    expect(overview.models).toEqual([{ name: 'gpt-4o', cost: 1.2, tokens: 3000 }]);
    expect(overview.evals).toHaveLength(1);
    expect(overview.evals[0].scores[22]).toBe(0.7);
    expect(overview.evals[0].scores[21]).toBeNull();
  });

  it('rejects a missing project but gives an empty pulse for a missing health node', () => {
    expect(() => parseProjectOverview(null, window)).toThrow('no metrics for this project');

    const empty = parseProjectHealth('p', null, window);

    expect(empty.status).toHaveLength(25);
    expect(empty.status.every((bin) => bin.ok === 0 && bin.errors === 0)).toBe(true);
  });
});

describe('project health', () => {
  const window = createMetricsWindow('day', now, offset);
  const steady = Array.from({ length: 21 }, (): [number, number] => [20, 0]);

  it('flags an error spike in the recent bins even when the day is calm', () => {
    const status = hourly([...steady, [17, 3], [16, 4], [15, 5], [3, 1]]);

    expect(assessProject(health(status, { traces: 480, errors: 10, p95: null }), window)).toEqual({
      kind: 'errors',
      summary: '20% errors in the last 4h, usually 1.1%',
    });
  });

  it('ignores a couple of stray errors', () => {
    const status = hourly([...steady, [20, 1], [20, 0], [20, 1], [3, 0]]);

    expect(assessProject(health(status), window)).toBeNull();
  });

  it('flags a project that went quiet', () => {
    const status = hourly([...steady, [0, 0], [1, 0], [0, 0], [0, 0]]);

    expect(assessProject(health(status), window)).toEqual({
      kind: 'quiet',
      summary: 'Traffic down 99% in the last 4h',
    });
  });

  it('does not call an idle project quiet', () => {
    const status = hourly(Array.from({ length: 25 }, (): [number, number] => [0, 0]));

    expect(assessProject(health(status), window)).toBeNull();
  });

  it('flags a slower p95 against the previous window', () => {
    const status = hourly([...steady, [20, 0], [20, 0], [20, 0], [5, 0]]);

    expect(
      assessProject(health(status, { traces: 480, errors: 0, p95: 1600 }, 4100), window),
    ).toEqual({ kind: 'slower', summary: 'p95 4.10s, was 1.60s' });
  });

  it('ignores a slower p95 from a handful of traces', () => {
    const sparse = hourly(
      Array.from({ length: 25 }, (_, index): [number, number] => [index % 9 === 0 ? 2 : 0, 0]),
    );

    expect(
      assessProject(health(sparse, { traces: 12, errors: 0, p95: 1500 }, 2270), window),
    ).toBeNull();
  });

  it('formats rates and costs compactly', () => {
    expect(formatPercent(0.068)).toBe('6.8%');
    expect(formatPercent(0.17)).toBe('17%');
    expect(formatPercent(0.0004)).toBe('<0.1%');
    expect(formatCost(0.004)).toBe('<$0.01');
    expect(formatCost(12.8)).toBe('$12.80');
    expect(formatCost(1520)).toBe('$1.5k');
  });
});

describe('overview store', () => {
  it('keeps the first window, and a new range clears the selection', () => {
    const key = overviewKey('instance', 'project');
    const first = createMetricsWindow('day', now, offset);
    const later = createMetricsWindow('day', now + 60_000, offset);
    const store = useOverviewStore.getState();

    store.ensure(key, first);
    store.ensure(key, later);
    useOverviewStore.getState().select(key, 3);

    expect(useOverviewStore.getState().entries[key]).toEqual({ window: first, selected: 3 });

    useOverviewStore.getState().setWindow(key, later);

    expect(useOverviewStore.getState().entries[key]).toEqual({ window: later, selected: null });
  });
});
