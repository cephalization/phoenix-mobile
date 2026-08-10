import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  discoverOAuth,
  OAUTH_CALLBACK_URL,
  parseOAuthCallback,
  PhoenixAuthError,
  registerOAuthClient,
  tokenResponseSchema,
} from './oauth';

vi.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digest: vi.fn(),
  getRandomBytesAsync: vi.fn(),
}));

const baseUrl = 'https://phoenix.example.test/phoenix';

function metadata(overrides: Record<string, unknown> = {}) {
  return {
    issuer: baseUrl,
    authorization_endpoint: `${baseUrl}/oauth/authorize`,
    token_endpoint: `${baseUrl}/oauth/token`,
    revocation_endpoint: `${baseUrl}/oauth/revoke`,
    registration_endpoint: `${baseUrl}/oauth/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    ...overrides,
  };
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

async function expectAuthError(promise: Promise<unknown>, code: PhoenixAuthError['code']) {
  await expect(promise).rejects.toMatchObject({ code });
}

describe('OAuth discovery', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('accepts valid extensible Phoenix metadata', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(metadata({
      phoenix_extension: { supported: true },
      scopes_supported: ['openid', 'profile'],
    })));

    await expect(discoverOAuth(`${baseUrl}/`)).resolves.toEqual({
      type: 'oauth2',
      allowInsecureTransport: false,
      issuer: baseUrl,
      authorizationEndpoint: `${baseUrl}/oauth/authorize`,
      tokenEndpoint: `${baseUrl}/oauth/token`,
      revocationEndpoint: `${baseUrl}/oauth/revoke`,
      registrationEndpoint: `${baseUrl}/oauth/register`,
    });
  });

  it('rejects HTML and malformed discovery responses', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response('<html>not metadata</html>', {
        headers: { 'content-type': 'text/html' },
      }))
      .mockResolvedValueOnce(jsonResponse(metadata({ response_types_supported: 'code' })));

    await expectAuthError(discoverOAuth(baseUrl), 'invalid_server');
    await expectAuthError(discoverOAuth(baseUrl), 'invalid_server');
  });

  it.each([
    ['wrong issuer origin', { issuer: 'https://attacker.example.test/phoenix' }],
    ['wrong issuer path', { issuer: 'https://phoenix.example.test/other' }],
    ['insecure endpoint', { token_endpoint: 'http://phoenix.example.test/phoenix/oauth/token' }],
    ['endpoint outside deployment', { authorization_endpoint: 'https://phoenix.example.test/oauth/authorize' }],
    ['credential-bearing endpoint', { revocation_endpoint: 'https://user:secret@phoenix.example.test/phoenix/oauth/revoke' }],
  ])('rejects %s', async (_label, override) => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(metadata(override)));
    await expectAuthError(discoverOAuth(baseUrl), 'invalid_server');
  });

  it('reports a missing registration endpoint as specifically unsupported', async () => {
    const discovered = await (async () => {
      const { registration_endpoint: _registrationEndpoint, ...value } = metadata();
      vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(value));
      return discoverOAuth(baseUrl);
    })();

    await expect(registerOAuthClient(discovered)).rejects.toMatchObject({
      code: 'unavailable',
      message: expect.stringContaining('dynamic client registration'),
    });
  });

  it('requires explicit consent for authenticated HTTP deployments', async () => {
    const localBaseUrl = 'http://192.168.1.65:6006';
    await expectAuthError(discoverOAuth(localBaseUrl), 'unavailable');

    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(metadata({
      issuer: localBaseUrl,
      authorization_endpoint: `${localBaseUrl}/oauth2/authorize`,
      token_endpoint: `${localBaseUrl}/oauth2/token`,
      revocation_endpoint: `${localBaseUrl}/oauth2/revoke`,
      registration_endpoint: `${localBaseUrl}/oauth2/register`,
    })));

    await expect(discoverOAuth(localBaseUrl, true)).resolves.toMatchObject({
      allowInsecureTransport: true,
      issuer: localBaseUrl,
    });
  });
});

describe('OAuth callbacks', () => {
  it('accepts only the exact private callback and expected state', () => {
    expect(parseOAuthCallback(`${OAUTH_CALLBACK_URL}?state=expected&code=auth-code`, 'expected')).toBe('auth-code');

    for (const callback of [
      'otherapp://oauth/callback?state=expected&code=x',
      'phoenixmobile://other/callback?state=expected&code=x',
      'phoenixmobile://oauth/other?state=expected&code=x',
      `${OAUTH_CALLBACK_URL}?state=wrong&code=x`,
    ]) {
      expect(() => parseOAuthCallback(callback, 'expected')).toThrow(expect.objectContaining({ code: 'invalid_callback' }));
    }
  });

  it('distinguishes access denial and rejects a missing code', () => {
    expect(() => parseOAuthCallback(`${OAUTH_CALLBACK_URL}?state=s&error=access_denied`, 's'))
      .toThrow(expect.objectContaining({ code: 'cancelled' }));
    expect(() => parseOAuthCallback(`${OAUTH_CALLBACK_URL}?state=s`, 's'))
      .toThrow(expect.objectContaining({ code: 'invalid_callback' }));
  });
});

describe('OAuth token responses', () => {
  it('accepts valid responses with unknown fields', () => {
    expect(tokenResponseSchema.parse({
      access_token: 'access',
      refresh_token: 'refresh',
      expires_in: 300,
      token_type: 'Bearer',
      scope: 'openid',
      server_extension: true,
    })).toMatchObject({ access_token: 'access', refresh_token: 'refresh' });
  });

  it.each([
    { access_token: '', refresh_token: 'refresh', expires_in: 300, token_type: 'Bearer' },
    { access_token: 'access', refresh_token: '', expires_in: 300, token_type: 'Bearer' },
    { access_token: 'access', refresh_token: 'refresh', expires_in: 0, token_type: 'Bearer' },
    { access_token: 'access', refresh_token: 'refresh', expires_in: 300, token_type: 'MAC' },
  ])('rejects malformed response %#', (response) => {
    expect(tokenResponseSchema.safeParse(response).success).toBe(false);
  });
});
