import type { PhoenixInstance } from '@/types/instance';

import { PhoenixAuthError } from './oauth';

export async function getAuthorizationHeaders(
  instance: PhoenixInstance,
  _forceRefresh = false,
  _staleAccessToken?: string,
): Promise<Record<string, string>> {
  if (instance.auth.type === 'none') return {};
  throw new PhoenixAuthError(
    'OAuth connections are available in the iOS and Android apps.',
    'unavailable',
  );
}

export async function authenticatedFetch(
  instance: PhoenixInstance,
  input: RequestInfo | URL,
  init: RequestInit = {},
  _retryUnauthorized = false,
): Promise<Response> {
  const headers = new Headers(input instanceof Request ? input.headers : undefined);
  new Headers(init.headers).forEach((value, key) => headers.set(key, value));

  for (const [key, value] of Object.entries(await getAuthorizationHeaders(instance)))
    headers.set(key, value);

  return fetch(input, { ...init, headers });
}

export async function revokeAndDeleteCredentials(
  _instance: PhoenixInstance,
  _permanent = false,
): Promise<void> {}
