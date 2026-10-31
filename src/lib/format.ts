/**
 * Compact figures for rows and stat strips. They are set in the monospaced
 * face, so they favour short fixed forms: `840ms`, `1.2s`, `14k`, `5m`.
 */

export function formatDuration(milliseconds: number): string {
  if (milliseconds < 1) return '<1ms';

  if (milliseconds < 1000) return `${Math.round(milliseconds)}ms`;

  if (milliseconds < 10_000) return `${(milliseconds / 1000).toFixed(2)}s`;

  if (milliseconds < 60_000) return `${(milliseconds / 1000).toFixed(1)}s`;

  const minutes = Math.floor(milliseconds / 60_000);
  const seconds = Math.round((milliseconds % 60_000) / 1000);

  return `${minutes}m${String(seconds).padStart(2, '0')}s`;
}

export function formatCompactNumber(value: number): string {
  if (value < 1000) return String(value);

  if (value < 1_000_000) return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)}k`;

  return `${(value / 1_000_000).toFixed(value < 10_000_000 ? 1 : 0)}m`;
}

/** Elapsed time since `value`: `now`, `5m`, `3h`, `2d`, then a short date. */
export function formatRelativeTime(
  value: string | number | Date,
  now: number = Date.now(),
): string {
  const time = new Date(value).getTime();

  if (Number.isNaN(time)) return '—';
  const seconds = Math.max(0, Math.round((now - time) / 1000));

  if (seconds < 45) return 'now';

  if (seconds < 3600) return `${Math.max(1, Math.round(seconds / 60))}m`;

  if (seconds < 86_400) return `${Math.round(seconds / 3600)}h`;

  if (seconds < 7 * 86_400) return `${Math.round(seconds / 86_400)}d`;

  return new Date(time).toLocaleDateString([], { day: 'numeric', month: 'short' });
}
