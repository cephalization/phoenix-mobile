import { createClient, type PhoenixClient } from '@arizeai/phoenix-client';

import { authenticatedFetch, getAuthorizationHeaders } from '@/features/auth/session';
import type { PhoenixInstance } from '@/types/instance';

export async function createPhoenixClient(instance: PhoenixInstance): Promise<PhoenixClient> {
  const headers = await getAuthorizationHeaders(instance);

  return createClient({
    getEnvironmentOptions: () => ({}),
    options: {
      baseUrl: instance.baseUrl,
      headers,
      fetch: (request) =>
        authenticatedFetch(
          instance,
          request,
          undefined,
          request.method === 'GET' || request.method === 'HEAD',
        ),
    },
  });
}

export class PhoenixUrlError extends Error {}

export function normalizePhoenixUrl(value: string): string {
  const input = value.trim();
  const candidate = /^https?:\/\//i.test(input) ? input : `http://${input}`;
  const url = new URL(candidate);

  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) {
    throw new PhoenixUrlError('Enter a valid HTTP or HTTPS host.');
  }

  // A userinfo credential would persist in plaintext with the instance metadata.
  if (url.username || url.password) {
    throw new PhoenixUrlError(
      'Remove the username and password from the address. Phoenix Mobile does not store credentials in connection URLs.',
    );
  }

  url.hash = '';
  url.search = '';

  return url.toString().replace(/\/$/, '');
}

export function createInstanceId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
