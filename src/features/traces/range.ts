import type { PhoenixTraceFilter, PhoenixTraceRange } from '@/hooks/use-phoenix-data';
import type { TraceRangePreset } from '@/store/settings';

export type TraceRangeSelection = PhoenixTraceRange & { preset: TraceRangePreset };

export const TraceRangePresets: readonly {
  durationMs: number;
  label: string;
  shortLabel: string;
  value: TraceRangePreset;
}[] = [
  { durationMs: 60 * 60 * 1000, label: 'Last hour', shortLabel: '1h', value: 'hour' },
  { durationMs: 24 * 60 * 60 * 1000, label: 'Last 24 hours', shortLabel: '24h', value: 'day' },
  { durationMs: 7 * 24 * 60 * 60 * 1000, label: 'Last 7 days', shortLabel: '7d', value: 'week' },
  {
    durationMs: 30 * 24 * 60 * 60 * 1000,
    label: 'Last 30 days',
    shortLabel: '30d',
    value: 'month',
  },
];

export const TraceFilters: readonly { label: string; value: PhoenixTraceFilter }[] = [
  { label: 'Recent', value: 'recent' },
  { label: 'Errors', value: 'errors' },
  { label: 'Slowest', value: 'slowest' },
];

/** The view the filter menu's plain glyph stands for; anything else fills it. */
export const DefaultTraceView = {
  filter: 'recent',
  preset: 'day',
  streaming: false,
} as const satisfies {
  filter: PhoenixTraceFilter;
  preset: TraceRangePreset;
  streaming: boolean;
};

export function traceRangePreset(preset: TraceRangePreset) {
  return TraceRangePresets.find((option) => option.value === preset) ?? TraceRangePresets[1];
}

export function traceFilterLabel(filter: PhoenixTraceFilter) {
  return TraceFilters.find((option) => option.value === filter)?.label ?? 'Recent';
}

/** A window ending now. Passing `cacheKey` keeps a poll on the same query entry. */
export function createTraceRange(preset: TraceRangePreset, cacheKey?: string): TraceRangeSelection {
  const endTime = new Date();

  return {
    cacheKey: cacheKey ?? `${preset}:${endTime.toISOString()}`,
    endTime: endTime.toISOString(),
    preset,
    startTime: new Date(endTime.getTime() - traceRangePreset(preset).durationMs).toISOString(),
  };
}
