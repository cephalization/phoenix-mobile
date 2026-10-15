import type * as ExpoCrypto from 'expo-crypto';
import type * as ExpoSecureStore from 'expo-secure-store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PhoenixInstance } from '@/types/instance';

import {
  authenticatedFetch,
  type Credential,
  getAuthorizationHeaders,
  loadOAuthTransaction,
  revokeAndDeleteCredentials,
} from './session';

const secureStore = vi.hoisted(() => {
  const values = new Map<string, string>();

  return {
    values,
    deleteItemAsync: vi.fn<typeof ExpoSecureStore.deleteItemAsync>(async (key) => {
      values.delete(key);
    }),
    getItemAsync: vi.fn<typeof ExpoSecureStore.getItemAsync>(
      async (key) => values.get(key) ?? null,
    ),
    setItemAsync: vi.fn<typeof ExpoSecureStore.setItemAsync>(async (key, value) => {
      values.set(key, value);
    }),
  };
});

vi.mock('expo-secure-store', () => secureStore);

vi.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digest: vi.fn<typeof ExpoCrypto.digest>(),
  getRandomBytesAsync: vi.fn<typeof ExpoCrypto.getRandomBytesAsync>(),
}));

const now = Date.parse('2026-07-24T12:00:00.000Z');

function instance(key: string): PhoenixInstance {
  const baseUrl = 'https://phoenix.example.test/phoenix';

  return {
    id: `instance-${key}`,
    name: 'Phoenix',
    baseUrl,
    auth: {
      type: 'oauth2',
      allowInsecureTransport: false,
      authorizationEndpoint: `${baseUrl}/oauth/authorize`,
      clientId: `client-${key}`,
      credentialKey: `credential-${key}`,
      issuer: baseUrl,
      registrationEndpoint: `${baseUrl}/oauth/register`,
      revocationEndpoint: `${baseUrl}/oauth/revoke`,
      tokenEndpoint: `${baseUrl}/oauth/token`,
    },
    createdAt: '2026-07-24T00:00:00.000Z',
  };
}

function credential(target: PhoenixInstance, overrides: Partial<Credential> = {}): Credential {
  if (target.auth.type !== 'oauth2') throw new Error('OAuth test instance required.');

  return {
    version: 3,
    accessToken: 'access-old',
    refreshToken: 'refresh-old',
    expiresAt: now + 5 * 60_000,
    scope: 'openid',
    issuer: target.auth.issuer,
    clientId: target.auth.clientId,
    instanceId: target.id,
    baseUrl: target.baseUrl,
    credentialKey: target.auth.credentialKey,
    allowInsecureTransport: target.auth.allowInsecureTransport,
    ...overrides,
  };
}

function storeCredential(target: PhoenixInstance, overrides: Partial<Credential> = {}) {
  if (target.auth.type !== 'oauth2') throw new Error('OAuth test instance required.');
  secureStore.values.set(target.auth.credentialKey, JSON.stringify(credential(target, overrides)));
}

function tokenResponse(accessToken = 'access-new', refreshToken = 'refresh-new'): Response {
  return new Response(
    JSON.stringify({
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_in: 3600,
      token_type: 'Bearer',
      extension: 'tolerated',
    }),
    { headers: { 'content-type': 'application/json' } },
  );
}

describe('OAuth credential sessions', () => {
  beforeEach(() => {
    secureStore.values.clear();
    secureStore.deleteItemAsync.mockClear();
    secureStore.getItemAsync.mockClear();
    secureStore.setItemAsync.mockClear();
    vi.useFakeTimers();
    vi.setSystemTime(now);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it.each([
    ['issuer', { issuer: 'https://phoenix.example.test/wrong' }],
    ['client', { clientId: 'wrong-client' }],
    ['instance', { instanceId: 'wrong-instance' }],
    ['base URL', { baseUrl: 'https://phoenix.example.test/wrong' }],
  ])('rejects and removes credentials bound to the wrong %s', async (suffix, override) => {
    const target = instance(`binding-${suffix}`);
    storeCredential(target, override);

    await expect(getAuthorizationHeaders(target)).rejects.toMatchObject({ code: 'login_required' });
    expect(
      secureStore.values.has(target.auth.type === 'oauth2' ? target.auth.credentialKey : ''),
    ).toBe(false);
  });

  it('refreshes at the 60-second boundary but not one millisecond above it', async () => {
    const boundary = instance('boundary');
    const above = instance('above-boundary');
    storeCredential(boundary, { expiresAt: now + 60_000 });
    storeCredential(above, { expiresAt: now + 60_001, accessToken: 'still-valid' });
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(tokenResponse());
    vi.stubGlobal('fetch', fetchMock);

    await expect(getAuthorizationHeaders(above)).resolves.toEqual({
      Authorization: 'Bearer still-valid',
    });
    await expect(getAuthorizationHeaders(boundary)).resolves.toEqual({
      Authorization: 'Bearer access-new',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('coalesces concurrent access into one rotating refresh request', async () => {
    const target = instance('concurrent');
    storeCredential(target, { expiresAt: now + 1 });
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(tokenResponse());
    vi.stubGlobal('fetch', fetchMock);

    const [first, second] = await Promise.all([
      getAuthorizationHeaders(target),
      getAuthorizationHeaders(target),
    ]);

    expect(first).toEqual({ Authorization: 'Bearer access-new' });
    expect(second).toEqual(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('turns a second 401 after one safe refresh retry into login_required', async () => {
    const target = instance('second-401');
    storeCredential(target);

    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);

      if (url.endsWith('/oauth/token')) return tokenResponse();
      expect(init?.redirect).toBe('error');

      return new Response(null, { status: 401 });
    });

    vi.stubGlobal('fetch', fetchMock);

    await expect(
      authenticatedFetch(target, `${target.baseUrl}/v1/projects`, {}, true),
    ).rejects.toMatchObject({ code: 'login_required' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('uses redirect:error for credential-bearing fetches', async () => {
    const target = instance('redirect');
    storeCredential(target);
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await authenticatedFetch(target, `${target.baseUrl}/v1/user`);

    expect(fetchMock).toHaveBeenCalledWith(
      `${target.baseUrl}/v1/user`,
      expect.objectContaining({ redirect: 'error' }),
    );
  });

  it('does not let an in-flight refresh resurrect permanently removed credentials', async () => {
    const target = instance('removal-barrier');
    storeCredential(target, { expiresAt: now + 1 });
    let resolveRefresh!: (response: Response) => void;

    const pendingRefresh = new Promise<Response>((resolve) => {
      resolveRefresh = resolve;
    });

    const fetchMock = vi.fn<typeof fetch>((input) => {
      if (String(input).endsWith('/oauth/token')) return pendingRefresh;

      return Promise.resolve(new Response(null, { status: 200 }));
    });

    vi.stubGlobal('fetch', fetchMock);

    const access = getAuthorizationHeaders(target);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const removal = revokeAndDeleteCredentials(target, true);
    resolveRefresh(tokenResponse());

    await expect(access).rejects.toMatchObject({ code: 'login_required' });
    await removal;
    expect(
      secureStore.values.has(target.auth.type === 'oauth2' ? target.auth.credentialKey : ''),
    ).toBe(false);
    expect(secureStore.setItemAsync).not.toHaveBeenCalled();
  });

  it('cleans up malformed credentials and transactions', async () => {
    const target = instance('malformed');

    if (target.auth.type !== 'oauth2') throw new Error('OAuth test instance required.');
    secureStore.values.set(target.auth.credentialKey, '{not-json');
    secureStore.values.set(
      'phoenix.oauth.transaction.v1',
      JSON.stringify({ version: 1, state: '' }),
    );

    await expect(getAuthorizationHeaders(target)).rejects.toMatchObject({ code: 'login_required' });
    await expect(loadOAuthTransaction()).rejects.toMatchObject({ code: 'invalid_callback' });
    expect(secureStore.values.has(target.auth.credentialKey)).toBe(false);
    expect(secureStore.values.has('phoenix.oauth.transaction.v1')).toBe(false);
  });
});
