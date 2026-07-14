import { createClient, type PhoenixClient } from '@arizeai/phoenix-client';

import type { PhoenixInstance } from '@/types/instance';

export function createPhoenixClient(instance: PhoenixInstance): PhoenixClient {
  if (instance.auth.type !== 'none') {
    throw new Error('OAuth connections are not supported yet.');
  }

  return createClient({
    getEnvironmentOptions: () => ({}),
    options: { baseUrl: instance.baseUrl },
  });
}

export function normalizePhoenixUrl(value: string): string {
  const input = value.trim();
  const candidate = /^https?:\/\//i.test(input) ? input : `http://${input}`;
  const url = new URL(candidate);

  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) {
    throw new Error('Enter a valid HTTP or HTTPS host.');
  }

  url.hash = '';
  url.search = '';
  return url.toString().replace(/\/$/, '');
}

export function createInstanceId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
