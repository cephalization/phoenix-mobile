import { traceRangePreset } from '@/features/traces/range';
import type { TraceRangePreset } from '@/store/settings';

/** Phoenix's `TimeBinScale` values the overview uses. */
export type MetricsScale = 'MINUTE' | 'HOUR' | 'DAY';

/**
 * A metrics window: the preset's duration ending now, with its start moved
 * back to a local bin boundary so the first bar is a whole bin, and the window
 * of the same length before it for comparisons.
 */
export type MetricsWindow = {
  /** The query identity; `createTraceRange`'s form so the offline copy keeps the preset. */
  cacheKey: string;
  preset: TraceRangePreset;
  start: number;
  end: number;
  previousStart: number;
  scale: MetricsScale;
  binMs: number;
  /** Minutes east of UTC, which Phoenix uses to bin by local hours and days. */
  utcOffsetMinutes: number;
  /** Bin start times, oldest first. */
  bins: number[];
};

const Minute = 60_000;
const Hour = 60 * Minute;
const Day = 24 * Hour;

const Bins: Record<TraceRangePreset, { scale: MetricsScale; binMs: number }> = {
  hour: { scale: 'MINUTE', binMs: Minute },
  day: { scale: 'HOUR', binMs: Hour },
  week: { scale: 'HOUR', binMs: Hour },
  month: { scale: 'DAY', binMs: Day },
};

export function createMetricsWindow(
  preset: TraceRangePreset,
  now: number = Date.now(),
  utcOffsetMinutes: number = -new Date(now).getTimezoneOffset(),
): MetricsWindow {
  const { binMs, scale } = Bins[preset];
  const duration = traceRangePreset(preset).durationMs;
  const offsetMs = utcOffsetMinutes * Minute;
  const start = Math.floor((now - duration + offsetMs) / binMs) * binMs - offsetMs;
  const bins: number[] = [];

  for (let bin = start; bin < now; bin += binMs) bins.push(bin);

  return {
    cacheKey: `${preset}:${new Date(now).toISOString()}`,
    preset,
    start,
    end: now,
    previousStart: start - (now - start),
    scale,
    binMs,
    utcOffsetMinutes,
    bins,
  };
}

/** The bin a server timestamp falls in, or -1 outside the window. */
export function binIndex(window: MetricsWindow, timestamp: number): number {
  const index = Math.round((timestamp - window.start) / window.binMs);

  return index >= 0 && index < window.bins.length ? index : -1;
}

/** `2 PM`, `2:05 PM`, or `Tue 4`, by the window's bin size. */
export function formatBinStart(window: MetricsWindow, start: number): string {
  const date = new Date(start);

  if (window.scale === 'DAY') {
    return date.toLocaleDateString([], { day: 'numeric', weekday: 'short' });
  }

  if (window.scale === 'MINUTE') {
    return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }

  return window.preset === 'week'
    ? `${date.toLocaleDateString([], { weekday: 'short' })} ${date.toLocaleTimeString([], { hour: 'numeric' })}`
    : date.toLocaleTimeString([], { hour: 'numeric' });
}

/** A bin's span for a readout: `2–3 PM`, `2:05 PM`, `Tue 4`. */
export function formatBinRange(window: MetricsWindow, start: number): string {
  if (window.scale !== 'HOUR') return formatBinStart(window, start);

  return `${formatBinStart(window, start)} – ${new Date(start + window.binMs).toLocaleTimeString([], { hour: 'numeric' })}`;
}

/** The trailing stretch the health checks compare against the rest: at least three bins. */
export function recentBinCount(window: MetricsWindow): number {
  return Math.max(3, Math.ceil(window.bins.length / 8));
}

/** `3h`, `45m`, or `2d` for the recent stretch. */
export function formatSpan(milliseconds: number): string {
  if (milliseconds >= Day && milliseconds % Day === 0) return `${milliseconds / Day}d`;

  if (milliseconds >= Hour) return `${Math.round(milliseconds / Hour)}h`;

  return `${Math.round(milliseconds / Minute)}m`;
}
