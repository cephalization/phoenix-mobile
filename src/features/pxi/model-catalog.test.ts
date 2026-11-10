import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';

import type { JsonValue } from '@/lib/json';
import type { PhoenixInstance } from '@/types/instance';
import { requestBodyText } from '@/test/fetch-calls';

import { fetchPxiModelCatalog } from './model-catalog';

vi.mock('expo-crypto', () => ({}));

vi.mock('expo-secure-store', () => ({}));

const instance: PhoenixInstance = {
  auth: { type: 'none' },
  baseUrl: 'http://phoenix.local:6006/',
  createdAt: '2026-10-31T00:00:00.000Z',
  id: 'instance-1',
  name: 'Phoenix',
};

const fetchMock = vi.fn<typeof fetch>();

function graphQLResponse(data: JsonValue): Response {
  return new Response(JSON.stringify({ data }), {
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('fetchPxiModelCatalog', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reads every provider, pages custom providers, and skips unknown shapes', async () => {
    fetchMock
      .mockResolvedValueOnce(
        graphQLResponse({
          modelProviders: [
            {
              key: 'ANTHROPIC',
              name: 'Anthropic',
              dependenciesInstalled: true,
              credentialsSet: true,
            },
            { key: 'XAI', name: 'xAI', dependenciesInstalled: true, credentialsSet: false },
            { key: 'FUTURE', name: 'Future', dependenciesInstalled: true, credentialsSet: true },
          ],
          playgroundModels: [
            { name: 'claude-opus-5-5', providerKey: 'ANTHROPIC' },
            { name: 'grok-4', providerKey: 'XAI' },
            { name: 'future-1', providerKey: 'FUTURE' },
            { name: 42, providerKey: 'XAI' },
          ],
          generativeModelCustomProviders: {
            edges: [{ node: { id: 'P1', name: 'One', sdk: 'OPENAI', modelNames: ['a'] } }],
            pageInfo: { hasNextPage: true, endCursor: 'c1' },
          },
        }),
      )
      .mockResolvedValueOnce(
        graphQLResponse({
          generativeModelCustomProviders: {
            edges: [{ node: { id: 'P2', name: 'Two', sdk: 'AWS_BEDROCK', modelNames: ['b'] } }],
            pageInfo: { hasNextPage: false, endCursor: 'c2' },
          },
        }),
      );

    const catalog = await fetchPxiModelCatalog(instance);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [url, init] = fetchMock.mock.calls[1] ?? [];

    expect(url).toBe('http://phoenix.local:6006/graphql');
    expect(JSON.parse(requestBodyText(init)).variables).toEqual({ after: 'c1' });

    expect(
      catalog.rows.map((row) => [row.providerName, row.modelName, row.credentialState]),
    ).toEqual([
      ['Anthropic', 'claude-opus-5-5', 'ready'],
      ['xAI', 'grok-4', 'no-key'],
      ['One', 'a', 'ready'],
      ['Two', 'b', 'ready'],
    ]);
    expect(catalog.providers.at(-1)).toMatchObject({ provider: 'AWS', customProviderId: 'P2' });
    expect(catalog.recommended.map((row) => row.displayName)).toEqual(['Claude Opus 5.5']);
    expect(catalog.defaultSelection).toEqual({
      providerType: 'builtin',
      provider: 'ANTHROPIC',
      modelName: 'claude-opus-5-5',
    });
  });
});
