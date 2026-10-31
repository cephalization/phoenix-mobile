import { describe, expect, it } from 'vitest';

import { formatCompactNumber, formatDuration, formatRelativeTime } from './format';

describe('formatDuration', () => {
  it('keeps short fixed forms', () => {
    expect(formatDuration(0.4)).toBe('<1ms');
    expect(formatDuration(840)).toBe('840ms');
    expect(formatDuration(1240)).toBe('1.24s');
    expect(formatDuration(12_400)).toBe('12.4s');
    expect(formatDuration(125_000)).toBe('2m05s');
  });
});

describe('formatCompactNumber', () => {
  it('abbreviates thousands and millions', () => {
    expect(formatCompactNumber(999)).toBe('999');
    expect(formatCompactNumber(1284)).toBe('1.3k');
    expect(formatCompactNumber(41_200)).toBe('41k');
    expect(formatCompactNumber(2_500_000)).toBe('2.5m');
  });
});

describe('formatRelativeTime', () => {
  const now = Date.parse('2026-10-30T12:00:00Z');

  it('counts up from now in minutes, hours, and days', () => {
    expect(formatRelativeTime('2026-10-30T11:59:40Z', now)).toBe('now');
    expect(formatRelativeTime('2026-10-30T11:55:00Z', now)).toBe('5m');
    expect(formatRelativeTime('2026-10-30T09:00:00Z', now)).toBe('3h');
    expect(formatRelativeTime('2026-10-28T12:00:00Z', now)).toBe('2d');
  });

  it('marks an unparseable time', () => {
    expect(formatRelativeTime('not a date', now)).toBe('—');
  });
});
