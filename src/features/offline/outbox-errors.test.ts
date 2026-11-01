import { describe, expect, it, vi } from 'vitest';

import { PhoenixAuthError } from '@/features/auth/oauth';
import { SessionReviewApiError, SessionReviewValidationError } from '@/features/session-review/api';

import { classifyReplayError, httpStatusOf, isOfflineError } from './outbox-errors';

// Importing the Phoenix client loads the native credential store and crypto modules, which
// have no Node implementation. The helpers under test never call them.
vi.mock('expo-secure-store', () => ({}));

vi.mock('expo-crypto', () => ({}));

function httpError(status: number) {
  return new SessionReviewApiError(
    'Phoenix could not save the session review',
    new Error(`http://192.168.1.65:6006/v1/session_annotations: ${status} Status`),
  );
}

describe('classifyReplayError', () => {
  it('sees a wrapped fetch failure as offline', () => {
    const error = new SessionReviewApiError(
      'Phoenix could not save the session review',
      new TypeError('Network request failed'),
    );

    expect(isOfflineError(error)).toBe(true);
    expect(classifyReplayError(error)).toEqual({ type: 'offline' });
  });

  it('sees an unreachable token refresh as offline', () => {
    expect(classifyReplayError(new PhoenixAuthError('No route', 'network'))).toEqual({
      type: 'offline',
    });
  });

  it('rejects client errors except timeouts and rate limits', () => {
    expect(classifyReplayError(httpError(403)).type).toBe('rejected');
    expect(classifyReplayError(httpError(422)).type).toBe('rejected');
    expect(classifyReplayError(httpError(408)).type).toBe('retryable');
    expect(classifyReplayError(httpError(429)).type).toBe('retryable');
    expect(classifyReplayError(httpError(503)).type).toBe('retryable');
  });

  it('rejects validation and sign-in errors', () => {
    const validation = new SessionReviewValidationError([
      { field: 'configName', message: 'Name taken.' },
    ]);

    expect(classifyReplayError(validation)).toEqual({ type: 'rejected', message: 'Name taken.' });
    expect(classifyReplayError(new PhoenixAuthError('Sign in', 'login_required')).type).toBe(
      'rejected',
    );
  });

  it('retries an unknown error', () => {
    expect(classifyReplayError(new Error('Something odd')).type).toBe('retryable');
  });
});

describe('httpStatusOf', () => {
  it('reads the status, not the URL port', () => {
    expect(httpStatusOf(httpError(409))).toBe(409);
    expect(httpStatusOf(new Error('http://host:6006/v1/x failed'))).toBeNull();
  });
});
