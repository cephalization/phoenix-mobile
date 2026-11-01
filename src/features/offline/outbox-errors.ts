import { PhoenixAuthError } from '@/features/auth/oauth';
import {
  SessionReviewCompatibilityError,
  SessionReviewValidationError,
} from '@/features/session-review/api';

import type { ReplayOutcome } from './outbox-model';
import { isNetworkFailure } from './reachability';

/**
 * The error and the causes under it. Session-review requests wrap the thrown
 * `fetch` or client error in a `SessionReviewApiError`, so a network failure
 * sits one or more `cause` links down.
 */
function errorChain(error: Error): Error[] {
  const chain: Error[] = [];
  let current: Error | undefined = error;

  while (current && chain.length < 8) {
    chain.push(current);
    current = current.cause instanceof Error ? current.cause : undefined;
  }

  return chain;
}

/** True when a write failed because the server could not be reached at all. */
export function isOfflineError(error: Error): boolean {
  return errorChain(error).some(
    (link) =>
      (link instanceof PhoenixAuthError && link.code === 'network') || isNetworkFailure(link),
  );
}

/**
 * The HTTP status a Phoenix client error carries. Its middleware throws
 * `Error("<url>: <status> <statusText>")`, and the space after the colon keeps
 * a URL port from matching.
 */
export function httpStatusOf(error: Error): number | null {
  for (const link of errorChain(error)) {
    const match = /:\s(\d{3})\b/.exec(link.message);

    if (match) return Number(match[1]);
  }

  return null;
}

/** How a failed replay attempt should be treated. */
export function classifyReplayError(error: Error): ReplayOutcome {
  if (isOfflineError(error)) return { type: 'offline' };

  const message = error.message || 'Phoenix could not accept this change.';

  if (
    error instanceof SessionReviewValidationError ||
    error instanceof SessionReviewCompatibilityError ||
    error instanceof PhoenixAuthError
  ) {
    return { type: 'rejected', message };
  }

  const status = httpStatusOf(error);

  if (status !== null && status >= 400 && status < 500 && status !== 408 && status !== 429) {
    return { type: 'rejected', message };
  }

  return { type: 'retryable', message };
}
