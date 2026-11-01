import { describe, expect, it } from 'vitest';

import {
  cachedNoticeText,
  hasSavedData,
  isUnavailableOffline,
  offlineInstanceText,
  pendingChangesText,
} from './offline-state';

const minute = 60_000;
const now = Date.UTC(2026, 9, 31, 12);

describe('cachedNoticeText', () => {
  it('says how old the shown data is', () => {
    expect(cachedNoticeText(now - 10_000, now)).toBe('Offline · Saved just now');
    expect(cachedNoticeText(now - 5 * minute, now)).toBe('Offline · Saved 5m ago');
    expect(cachedNoticeText(now - 120 * minute, now)).toBe('Offline · Saved 2h ago');
    expect(cachedNoticeText(now - 3 * 24 * 60 * minute, now)).toBe('Offline · Saved 3d ago');
  });

  it('reads a date without "ago" past a week', () => {
    const text = cachedNoticeText(now - 10 * 24 * 60 * minute, now);

    expect(text.startsWith('Offline · Saved ')).toBe(true);
    expect(text.endsWith('ago')).toBe(false);
  });

  it('says only Offline without data', () => {
    expect(cachedNoticeText(0, now)).toBe('Offline');
    expect(cachedNoticeText(undefined, now)).toBe('Offline');
  });
});

describe('pendingChangesText', () => {
  it('counts queued changes', () => {
    expect(pendingChangesText(0)).toBeNull();
    expect(pendingChangesText(1)).toBe('1 waiting');
    expect(pendingChangesText(3)).toBe('3 waiting');
  });
});

describe('isUnavailableOffline', () => {
  const networkError = new TypeError('Network request failed');

  it('is false whenever there is data to show', () => {
    expect(
      isUnavailableOffline({ data: [], error: networkError, fetchStatus: 'paused' }, true),
    ).toBe(false);
  });

  it('is true for a paused query or a failed connection without data', () => {
    expect(
      isUnavailableOffline({ data: undefined, error: null, fetchStatus: 'paused' }, true),
    ).toBe(true);
    expect(
      isUnavailableOffline({ data: undefined, error: networkError, fetchStatus: 'idle' }, false),
    ).toBe(true);
  });

  it('leaves server errors to the screen while the server answers', () => {
    const serverError = new Error('Phoenix could not load this trace.');

    expect(
      isUnavailableOffline({ data: undefined, error: serverError, fetchStatus: 'idle' }, false),
    ).toBe(false);
    expect(
      isUnavailableOffline({ data: undefined, error: null, fetchStatus: 'fetching' }, true),
    ).toBe(false);
  });
});

describe('offlineInstanceText', () => {
  it('counts saved projects', () => {
    expect(offlineInstanceText({ projectsList: true, projectIds: ['a'] })).toBe(
      'Offline · 1 project saved',
    );
    expect(offlineInstanceText({ projectsList: true, projectIds: ['a', 'b', 'c'] })).toBe(
      'Offline · 3 projects saved',
    );
  });

  it('says when only the projects list, or nothing, is saved', () => {
    expect(offlineInstanceText({ projectsList: true, projectIds: [] })).toBe(
      'Offline · Projects saved',
    );
    expect(offlineInstanceText({ projectsList: false, projectIds: [] })).toBe(
      'Offline · Nothing saved',
    );
    expect(hasSavedData({ projectsList: false, projectIds: [] })).toBe(false);
    expect(hasSavedData({ projectsList: false, projectIds: ['a'] })).toBe(true);
  });
});
