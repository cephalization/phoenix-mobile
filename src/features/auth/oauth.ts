import * as Crypto from 'expo-crypto';
import { z } from 'zod';

import type { InstanceAuth, PhoenixInstance } from '@/types/instance';

export const OAUTH_CALLBACK_URL = 'phoenixmobile://oauth/callback';
export const OAUTH_REFRESH_MARGIN_MS = 60_000;
const REQUEST_TIMEOUT_MS = 30_000;

const metadataSchema = z.object({
  issuer: z.string().url(),
  authorization_endpoint: z.string().url(),
  token_endpoint: z.string().url(),
  revocation_endpoint: z.string().url(),
  registration_endpoint: z.string().url().optional(),
  response_types_supported: z.array(z.string()),
  grant_types_supported: z.array(z.string()),
  code_challenge_methods_supported: z.array(z.string()),
  token_endpoint_auth_methods_supported: z.array(z.string()),
});

export const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  expires_in: z.number().int().positive(),
  token_type: z.string().regex(/^bearer$/i),
  scope: z.string().optional(),
});

const registrationSchema = z.object({
  client_id: z.string().min(1),
  client_name: z.string().nullable().optional(),
  redirect_uris: z.array(z.string()).min(1),
  grant_types: z.array(z.string()),
  response_types: z.array(z.string()),
  token_endpoint_auth_method: z.literal('none'),
  logo_uri: z.string().url().optional(),
});

const anonymousViewerSchema = z.object({
  data: z.object({ auth_method: z.literal('ANONYMOUS') }),
});

export class PhoenixAuthError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'cancelled'
      | 'invalid_callback'
      | 'invalid_server'
      | 'login_required'
      | 'network'
      | 'unavailable',
  ) {
    super(message);
    this.name = 'PhoenixAuthError';
  }
}

export async function probePhoenixAuth(baseUrl: string): Promise<'anonymous' | 'oauth-required'> {
  const deployment = parseDeploymentUrl(baseUrl, 'Phoenix address');
  let response: Response;

  try {
    response = await fetch(new URL('v1/user', withTrailingSlash(deployment)), {
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    throw new PhoenixAuthError('Could not reach Phoenix to check authentication.', 'network');
  }

  if (response.status === 401) return 'oauth-required';

  if (!response.ok)
    throw new PhoenixAuthError(
      `Phoenix authentication check failed with HTTP ${response.status}.`,
      'invalid_server',
    );
  let payload: unknown;

  try {
    payload = await response.json();
  } catch {
    throw new PhoenixAuthError(
      'Phoenix returned an invalid authentication response.',
      'invalid_server',
    );
  }

  if (!anonymousViewerSchema.safeParse(payload).success) {
    throw new PhoenixAuthError(
      'Phoenix returned an unexpected unauthenticated user response.',
      'invalid_server',
    );
  }

  return 'anonymous';
}

export async function discoverOAuth(
  baseUrl: string,
  allowInsecureTransport = false,
): Promise<Omit<Extract<InstanceAuth, { type: 'oauth2' }>, 'clientId' | 'credentialKey'>> {
  const deployment = parseDeploymentUrl(baseUrl, 'Phoenix address');

  if (deployment.protocol !== 'https:' && !allowInsecureTransport) {
    throw new PhoenixAuthError(
      'This server requires authentication, but OAuth credentials cannot be sent over HTTP. Configure HTTPS on Phoenix and try again.',
      'unavailable',
    );
  }

  const discoveryUrl = new URL(
    '.well-known/oauth-authorization-server',
    withTrailingSlash(deployment),
  );

  let response: Response;

  try {
    response = await fetch(discoveryUrl, { signal: AbortSignal.timeout(5_000) });
  } catch {
    throw new PhoenixAuthError('OAuth discovery could not reach this Phoenix server.', 'network');
  }

  if (!response.ok)
    throw new PhoenixAuthError(
      'This Phoenix server does not advertise OAuth login.',
      'unavailable',
    );
  let parsed: z.infer<typeof metadataSchema>;

  try {
    parsed = metadataSchema.parse(await response.json());
  } catch {
    throw new PhoenixAuthError(
      'Phoenix returned invalid OAuth discovery metadata.',
      'invalid_server',
    );
  }

  const issuer = parseDeploymentUrl(parsed.issuer, 'OAuth issuer');

  if (!sameDeployment(deployment, issuer)) {
    throw new PhoenixAuthError('Phoenix advertised an unsafe OAuth issuer.', 'invalid_server');
  }

  assertOAuthEndpointOrigins(
    parsed.issuer,
    [
      parsed.authorization_endpoint,
      parsed.token_endpoint,
      parsed.revocation_endpoint,
      ...(parsed.registration_endpoint ? [parsed.registration_endpoint] : []),
    ],
    allowInsecureTransport,
  );

  if (
    !parsed.response_types_supported.includes('code') ||
    !parsed.grant_types_supported.includes('authorization_code') ||
    !parsed.grant_types_supported.includes('refresh_token') ||
    !parsed.code_challenge_methods_supported.includes('S256') ||
    !parsed.token_endpoint_auth_methods_supported.includes('none')
  ) {
    throw new PhoenixAuthError(
      'Phoenix OAuth does not support the required authorization-code and S256 flow.',
      'unavailable',
    );
  }

  return {
    type: 'oauth2',
    allowInsecureTransport: deployment.protocol === 'http:',
    issuer: canonicalDeploymentUrl(issuer),
    authorizationEndpoint: parsed.authorization_endpoint,
    tokenEndpoint: parsed.token_endpoint,
    revocationEndpoint: parsed.revocation_endpoint,
    registrationEndpoint: parsed.registration_endpoint,
  };
}

export function assertOAuthEndpointOrigins(
  issuerValue: string,
  endpoints: string[],
  allowInsecureTransport = false,
): void {
  const issuer = parseDeploymentUrl(issuerValue, 'OAuth issuer');
  const expectedProtocol = allowInsecureTransport ? issuer.protocol : 'https:';

  if (expectedProtocol !== 'https:' && expectedProtocol !== 'http:') {
    throw new PhoenixAuthError('OAuth requires an HTTP or HTTPS issuer.', 'invalid_server');
  }

  if (!allowInsecureTransport && issuer.protocol !== 'https:') {
    throw new PhoenixAuthError('OAuth requires an HTTPS issuer.', 'invalid_server');
  }

  for (const endpoint of endpoints) {
    const url = parseAbsoluteUrl(endpoint, 'OAuth endpoint');

    if (url.protocol !== expectedProtocol || !isWithinDeployment(issuer, url)) {
      throw new PhoenixAuthError(
        'Phoenix advertised an OAuth endpoint outside its secure deployment path.',
        'invalid_server',
      );
    }
  }
}

export function assertOAuthInstanceBinding(instance: PhoenixInstance): void {
  if (instance.auth.type !== 'oauth2') return;
  const baseUrl = parseDeploymentUrl(instance.baseUrl, 'Phoenix address');
  const issuer = parseDeploymentUrl(instance.auth.issuer, 'OAuth issuer');

  if (!sameDeployment(baseUrl, issuer)) {
    throw new PhoenixAuthError(
      'The saved OAuth issuer does not match this Phoenix deployment.',
      'login_required',
    );
  }

  assertOAuthEndpointOrigins(
    instance.auth.issuer,
    [
      instance.auth.authorizationEndpoint,
      instance.auth.tokenEndpoint,
      instance.auth.revocationEndpoint,
      ...(instance.auth.registrationEndpoint ? [instance.auth.registrationEndpoint] : []),
    ],
    instance.auth.allowInsecureTransport,
  );
}

export function assertBearerRequestTarget(
  instance: PhoenixInstance,
  input: RequestInfo | URL,
): void {
  if (instance.auth.type !== 'oauth2') return;
  assertOAuthInstanceBinding(instance);
  const targetValue = input instanceof Request ? input.url : String(input);
  const target = parseAbsoluteUrl(targetValue, 'Phoenix request URL');
  const deployment = parseDeploymentUrl(instance.baseUrl, 'Phoenix address');

  if (!isWithinDeployment(deployment, target)) {
    throw new PhoenixAuthError(
      'Refusing to send Phoenix credentials outside this deployment.',
      'invalid_server',
    );
  }
}

export async function registerOAuthClient(
  metadata: Omit<Extract<InstanceAuth, { type: 'oauth2' }>, 'clientId' | 'credentialKey'>,
): Promise<string> {
  if (!metadata.registrationEndpoint) {
    throw new PhoenixAuthError(
      'This Phoenix server does not allow dynamic client registration. Ask an administrator to enable it for Phoenix Mobile.',
      'unavailable',
    );
  }

  assertOAuthEndpointOrigins(
    metadata.issuer,
    [metadata.registrationEndpoint],
    metadata.allowInsecureTransport,
  );
  let response: Response;

  try {
    response = await fetch(metadata.registrationEndpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        client_name: 'Phoenix Mobile',
        redirect_uris: [OAUTH_CALLBACK_URL],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new PhoenixAuthError(
      'Phoenix OAuth client registration could not be completed.',
      'network',
    );
  }

  if (!response.ok) {
    throw new PhoenixAuthError(
      response.status === 403
        ? 'Phoenix dynamic client registration is disabled. Enable it before connecting Phoenix Mobile.'
        : `Phoenix OAuth client registration failed with HTTP ${response.status}.`,
      'unavailable',
    );
  }

  let registration: z.infer<typeof registrationSchema>;

  try {
    registration = registrationSchema.parse(await response.json());
  } catch {
    throw new PhoenixAuthError(
      'Phoenix returned an invalid OAuth client registration.',
      'invalid_server',
    );
  }

  if (!registration.redirect_uris.includes(OAUTH_CALLBACK_URL)) {
    throw new PhoenixAuthError(
      'Phoenix did not register the required private callback URL.',
      'invalid_server',
    );
  }

  return registration.client_id;
}

export async function createPkce(): Promise<{
  challenge: string;
  state: string;
  verifier: string;
}> {
  const verifier = base64Url(await Crypto.getRandomBytesAsync(64));
  const state = base64Url(await Crypto.getRandomBytesAsync(32));

  const digest = await Crypto.digest(
    Crypto.CryptoDigestAlgorithm.SHA256,
    new TextEncoder().encode(verifier),
  );

  return { verifier, state, challenge: base64Url(new Uint8Array(digest)) };
}

export function buildAuthorizationUrl(
  instance: PhoenixInstance,
  state: string,
  challenge: string,
): string {
  if (instance.auth.type !== 'oauth2')
    throw new PhoenixAuthError('OAuth login metadata is missing.', 'invalid_server');
  assertOAuthEndpointOrigins(
    instance.auth.issuer,
    [instance.auth.authorizationEndpoint],
    instance.auth.allowInsecureTransport,
  );
  const url = new URL(instance.auth.authorizationEndpoint);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', instance.auth.clientId);
  url.searchParams.set('redirect_uri', OAUTH_CALLBACK_URL);
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('resource', instance.auth.issuer);

  return url.toString();
}

export function parseOAuthCallback(urlValue: string, expectedState: string): string {
  let url: URL;

  try {
    url = new URL(urlValue);
  } catch {
    throw new PhoenixAuthError('Phoenix returned an invalid OAuth callback.', 'invalid_callback');
  }

  if (
    url.protocol !== 'phoenixmobile:' ||
    url.hostname !== 'oauth' ||
    url.pathname !== '/callback'
  ) {
    throw new PhoenixAuthError(
      'Phoenix returned to an unexpected callback URL.',
      'invalid_callback',
    );
  }

  if (url.searchParams.get('state') !== expectedState) {
    throw new PhoenixAuthError('OAuth state validation failed. Sign in again.', 'invalid_callback');
  }

  const oauthError = url.searchParams.get('error');

  if (oauthError === 'access_denied')
    throw new PhoenixAuthError('Phoenix sign-in was cancelled.', 'cancelled');

  if (oauthError)
    throw new PhoenixAuthError(`Phoenix authorization failed: ${oauthError}.`, 'invalid_callback');
  const code = url.searchParams.get('code');

  if (!code)
    throw new PhoenixAuthError('Phoenix did not return an authorization code.', 'invalid_callback');

  return code;
}

export function assertPhoenix19(version: string): void {
  const major = Number.parseInt(version.split('.')[0] ?? '', 10);

  if (!Number.isFinite(major) || major < 19) {
    throw new PhoenixAuthError('OAuth login requires Phoenix 19 or newer.', 'unavailable');
  }
}

function base64Url(bytes: Uint8Array): string {
  let binary = '';

  for (const byte of bytes) binary += String.fromCharCode(byte);

  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function parseDeploymentUrl(value: string, label: string): URL {
  const url = parseAbsoluteUrl(value, label);

  if (!['http:', 'https:'].includes(url.protocol) || url.search || url.hash) {
    throw new PhoenixAuthError(`${label} is invalid.`, 'invalid_server');
  }

  return url;
}

function parseAbsoluteUrl(value: string, label: string): URL {
  try {
    const url = new URL(value);

    if (!url.hostname || url.username || url.password) throw new Error('unsafe URL');

    return url;
  } catch {
    throw new PhoenixAuthError(`${label} is invalid.`, 'invalid_server');
  }
}

function normalizedPath(url: URL): string {
  const path = url.pathname.replace(/\/+$/, '');

  return path || '/';
}

function sameDeployment(left: URL, right: URL): boolean {
  return (
    left.protocol === right.protocol &&
    left.origin === right.origin &&
    normalizedPath(left) === normalizedPath(right)
  );
}

function isWithinDeployment(deployment: URL, target: URL): boolean {
  if (deployment.protocol !== target.protocol || deployment.origin !== target.origin) return false;
  const root = normalizedPath(deployment);

  return root === '/' || target.pathname === root || target.pathname.startsWith(`${root}/`);
}

function canonicalDeploymentUrl(url: URL): string {
  return `${url.origin}${normalizedPath(url) === '/' ? '' : normalizedPath(url)}`;
}

function withTrailingSlash(url: URL): URL {
  return new URL(`${canonicalDeploymentUrl(url)}/`);
}
