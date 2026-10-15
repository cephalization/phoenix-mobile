import * as SecureStore from 'expo-secure-store';
import { z } from 'zod';

import { parseJsonValue } from '@/lib/json';
import type { PhoenixInstance } from '@/types/instance';

import {
  assertBearerRequestTarget,
  assertOAuthEndpointOrigins,
  assertOAuthInstanceBinding,
  OAUTH_CALLBACK_URL,
  OAUTH_REFRESH_MARGIN_MS,
  PhoenixAuthError,
  tokenResponseSchema,
} from './oauth';

const credentialSchema = z.object({
  version: z.literal(3),
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  expiresAt: z.number().int().positive(),
  scope: z.string(),
  issuer: z.string().url(),
  clientId: z.string().min(1),
  instanceId: z.string().min(1),
  baseUrl: z.string().url(),
  credentialKey: z.string().min(1),
  allowInsecureTransport: z.boolean(),
});

const instanceSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  baseUrl: z.string().url(),
  auth: z.object({
    type: z.literal('oauth2'),
    allowInsecureTransport: z.boolean(),
    authorizationEndpoint: z.string().url(),
    clientId: z.string().min(1),
    credentialKey: z.string().min(1),
    issuer: z.string().url(),
    registrationEndpoint: z.string().url().optional(),
    revocationEndpoint: z.string().url(),
    tokenEndpoint: z.string().url(),
  }),
  createdAt: z.string().datetime(),
});

export const transactionSchema = z.object({
  version: z.literal(1),
  instance: instanceSchema,
  state: z.string().min(1),
  verifier: z.string().min(43),
  createdAt: z.number().int().positive(),
});

export type OAuthTransaction = z.infer<typeof transactionSchema>;

type TokenResponse = z.infer<typeof tokenResponseSchema>;

export type Credential = z.infer<typeof credentialSchema>;

const TRANSACTION_KEY = 'phoenix.oauth.transaction.v1';
const operations = new Map<string, Promise<void>>();
const refreshes = new Map<string, Promise<string>>();
const generations = new Map<string, number>();
const removals = new Set<string>();

export async function saveOAuthTransaction(transaction: OAuthTransaction): Promise<void> {
  try {
    await SecureStore.setItemAsync(TRANSACTION_KEY, JSON.stringify(transaction));
  } catch (error) {
    await SecureStore.deleteItemAsync(TRANSACTION_KEY).catch(() => undefined);
    throw error;
  }
}

export async function loadOAuthTransaction(): Promise<OAuthTransaction> {
  const value = await SecureStore.getItemAsync(TRANSACTION_KEY);

  if (!value) throw new PhoenixAuthError('No active Phoenix sign-in was found.', 'login_required');

  try {
    const transaction = transactionSchema.parse(JSON.parse(value));
    assertOAuthInstanceBinding(transaction.instance);

    if (Date.now() - transaction.createdAt > 10 * 60_000) {
      await clearOAuthTransaction();
      throw new PhoenixAuthError('Phoenix sign-in expired. Start again.', 'login_required');
    }

    return transaction;
  } catch (error) {
    await clearOAuthTransaction().catch(() => undefined);

    if (error instanceof PhoenixAuthError) throw error;
    throw new PhoenixAuthError(
      'The saved Phoenix sign-in transaction is invalid.',
      'invalid_callback',
    );
  }
}

export async function clearOAuthTransaction(): Promise<void> {
  await SecureStore.deleteItemAsync(TRANSACTION_KEY);
}

export async function exchangeOAuthCode(
  instance: PhoenixInstance,
  code: string,
  verifier: string,
): Promise<void> {
  if (instance.auth.type !== 'oauth2')
    throw new PhoenixAuthError('OAuth login metadata is missing.', 'invalid_server');
  assertOAuthInstanceBinding(instance);
  const auth = instance.auth;
  const key = auth.credentialKey;
  await withCredentialOperation(key, async () => {
    if (removals.has(key)) throw loginRequired();
    generations.delete(key);
    const generation = currentGeneration(key);

    const response = await postToken(
      auth.tokenEndpoint,
      new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: auth.clientId,
        code,
        redirect_uri: OAUTH_CALLBACK_URL,
        code_verifier: verifier,
        resource: auth.issuer,
      }),
    );

    if (removals.has(key) || generation !== currentGeneration(key)) {
      await revokeRefreshToken(instance, response.refresh_token).catch(() => undefined);
      throw loginRequired();
    }

    try {
      await storeCredential(instance, response);
    } catch {
      markDeleted(key);
      await SecureStore.deleteItemAsync(key).catch(() => undefined);
      await revokeRefreshToken(instance, response.refresh_token).catch(() => undefined);
      throw new PhoenixAuthError(
        'Phoenix credentials could not be saved. Sign in again.',
        'login_required',
      );
    }
  });
}

export async function getAuthorizationHeaders(
  instance: PhoenixInstance,
  forceRefresh = false,
  staleAccessToken?: string,
): Promise<Record<string, string>> {
  if (instance.auth.type === 'none') return {};

  return {
    Authorization: `Bearer ${await getAccessToken(instance, forceRefresh, staleAccessToken)}`,
  };
}

export async function authenticatedFetch(
  instance: PhoenixInstance,
  input: RequestInfo | URL,
  init: RequestInit = {},
  retryUnauthorized = false,
): Promise<Response> {
  if (instance.auth.type === 'oauth2') assertBearerRequestTarget(instance, input);
  const inputHeaders = input instanceof Request ? input.headers : undefined;
  const headers = new Headers(inputHeaders);
  new Headers(init.headers).forEach((value, key) => headers.set(key, value));
  const authHeaders = await getAuthorizationHeaders(instance);
  const sentAccessToken = authHeaders.Authorization?.replace(/^Bearer\s+/i, '');

  for (const [key, value] of Object.entries(authHeaders)) headers.set(key, value);

  const requestInit: RequestInit = { ...init, headers };

  if (instance.auth.type === 'oauth2') requestInit.redirect = 'error';

  let response = await fetch(input, requestInit);

  if (response.status === 401 && instance.auth.type === 'oauth2' && retryUnauthorized) {
    headers.set('Authorization', `Bearer ${await getAccessToken(instance, true, sentAccessToken)}`);
    response = await fetch(input, requestInit);

    if (response.status === 401) {
      throw new PhoenixAuthError(
        'Phoenix rejected the refreshed session. Sign in again.',
        'login_required',
      );
    }
  }

  return response;
}

export async function revokeAndDeleteCredentials(
  instance: PhoenixInstance,
  permanent = false,
): Promise<void> {
  if (instance.auth.type !== 'oauth2') return;
  const key = instance.auth.credentialKey;

  if (permanent) removals.add(key);
  markDeleted(key);
  await withCredentialOperation(key, async () => {
    try {
      const credential = await readCredential(instance, true);
      await revokeRefreshToken(instance, credential.refreshToken).catch(() => undefined);
    } catch {
      // Missing or malformed local credentials still require a durable delete.
    } finally {
      await SecureStore.deleteItemAsync(key);
    }
  });
}

async function getAccessToken(
  instance: PhoenixInstance,
  forceRefresh: boolean,
  staleAccessToken?: string,
): Promise<string> {
  if (instance.auth.type !== 'oauth2')
    throw new PhoenixAuthError('This connection does not use OAuth.', 'login_required');
  assertOAuthInstanceBinding(instance);
  const key = instance.auth.credentialKey;

  if (isDeleted(key)) throw loginRequired();
  const active = refreshes.get(key);

  if (active) return active;

  const credential = await withCredentialOperation(key, () => readCredential(instance));

  if (isDeleted(key)) throw loginRequired();

  if (forceRefresh && staleAccessToken && credential.accessToken !== staleAccessToken)
    return credential.accessToken;

  if (!forceRefresh && credential.expiresAt - Date.now() > OAUTH_REFRESH_MARGIN_MS)
    return credential.accessToken;
  const observedRefreshToken = credential.refreshToken;

  const refresh = withCredentialOperation(key, () =>
    refreshCredential(instance, observedRefreshToken),
  ).finally(() => {
    if (refreshes.get(key) === refresh) refreshes.delete(key);
  });

  refreshes.set(key, refresh);

  return refresh;
}

async function refreshCredential(
  instance: PhoenixInstance,
  observedRefreshToken: string,
): Promise<string> {
  if (instance.auth.type !== 'oauth2') throw loginRequired();
  const key = instance.auth.credentialKey;
  const generation = currentGeneration(key);

  if (isDeleted(key)) throw loginRequired();
  const latest = await readCredential(instance);

  if (latest.refreshToken !== observedRefreshToken) return latest.accessToken;

  let response: TokenResponse;

  try {
    response = await postToken(
      instance.auth.tokenEndpoint,
      new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: instance.auth.clientId,
        refresh_token: latest.refreshToken,
        resource: instance.auth.issuer,
      }),
    );
  } catch (error) {
    markDeleted(key);
    await SecureStore.deleteItemAsync(key).catch(() => undefined);
    throw new PhoenixAuthError(
      error instanceof PhoenixAuthError && error.code !== 'network'
        ? error.message
        : 'Phoenix token refresh may not have completed. Sign in again; it was not retried.',
      'login_required',
    );
  }

  if (generation !== currentGeneration(key) || isDeleted(key)) {
    await revokeRefreshToken(instance, response.refresh_token).catch(() => undefined);
    throw loginRequired();
  }

  try {
    await storeCredential(instance, response);
  } catch {
    markDeleted(key);
    await SecureStore.deleteItemAsync(key).catch(() => undefined);
    await revokeRefreshToken(instance, response.refresh_token).catch(() => undefined);
    throw new PhoenixAuthError(
      'Refreshed Phoenix credentials could not be saved. Sign in again.',
      'login_required',
    );
  }

  return response.access_token;
}

async function postToken(endpoint: string, body: URLSearchParams): Promise<TokenResponse> {
  let response: Response;

  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
      redirect: 'error',
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new PhoenixAuthError(
      'Phoenix token request did not complete and was not retried.',
      'network',
    );
  }

  if (!response.ok)
    throw new PhoenixAuthError(
      `Phoenix rejected the OAuth grant with HTTP ${response.status}. Sign in again.`,
      'login_required',
    );

  try {
    return tokenResponseSchema.parse(await response.json());
  } catch {
    throw new PhoenixAuthError(
      'Phoenix returned an invalid OAuth token response.',
      'invalid_server',
    );
  }
}

async function revokeRefreshToken(instance: PhoenixInstance, refreshToken: string): Promise<void> {
  if (instance.auth.type !== 'oauth2') return;
  assertOAuthEndpointOrigins(
    instance.auth.issuer,
    [instance.auth.revocationEndpoint],
    instance.auth.allowInsecureTransport,
  );
  await fetch(instance.auth.revocationEndpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token: refreshToken, token_type_hint: 'refresh_token' }),
    redirect: 'error',
    signal: AbortSignal.timeout(10_000),
  });
}

async function readCredential(
  instance: PhoenixInstance,
  allowDeleted = false,
): Promise<Credential> {
  if (instance.auth.type !== 'oauth2') throw loginRequired();
  const key = instance.auth.credentialKey;

  if (!allowDeleted && isDeleted(key)) throw loginRequired();
  const raw = await SecureStore.getItemAsync(key);
  const parsed = raw ? credentialSchema.safeParse(parseJsonValue(raw)) : null;

  if (!parsed?.success || !credentialMatchesInstance(parsed.data, instance)) {
    if (raw) await SecureStore.deleteItemAsync(key).catch(() => undefined);
    throw loginRequired();
  }

  return parsed.data;
}

async function storeCredential(instance: PhoenixInstance, response: TokenResponse): Promise<void> {
  if (instance.auth.type !== 'oauth2') throw loginRequired();
  await SecureStore.setItemAsync(
    instance.auth.credentialKey,
    JSON.stringify({
      version: 3,
      accessToken: response.access_token,
      refreshToken: response.refresh_token,
      expiresAt: Date.now() + response.expires_in * 1_000,
      scope: response.scope ?? '',
      issuer: instance.auth.issuer,
      clientId: instance.auth.clientId,
      instanceId: instance.id,
      baseUrl: instance.baseUrl,
      credentialKey: instance.auth.credentialKey,
      allowInsecureTransport: instance.auth.allowInsecureTransport,
    } satisfies Credential),
  );
}

function credentialMatchesInstance(credential: Credential, instance: PhoenixInstance): boolean {
  return (
    instance.auth.type === 'oauth2' &&
    credential.issuer === instance.auth.issuer &&
    credential.clientId === instance.auth.clientId &&
    credential.instanceId === instance.id &&
    credential.baseUrl === instance.baseUrl &&
    credential.credentialKey === instance.auth.credentialKey &&
    credential.allowInsecureTransport === instance.auth.allowInsecureTransport
  );
}

async function withCredentialOperation<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const previous = operations.get(key) ?? Promise.resolve();
  let release!: () => void;

  const current = new Promise<void>((resolve) => {
    release = resolve;
  });

  operations.set(key, current);
  await previous.catch(() => undefined);

  try {
    return await operation();
  } finally {
    release();

    if (operations.get(key) === current) operations.delete(key);
  }
}

function currentGeneration(key: string): number {
  return generations.get(key) ?? 0;
}

function markDeleted(key: string): void {
  generations.set(key, currentGeneration(key) + 1);
}

function isDeleted(key: string): boolean {
  return generations.has(key);
}

function loginRequired(): PhoenixAuthError {
  return new PhoenixAuthError(
    'Phoenix credentials are missing or no longer valid. Sign in again.',
    'login_required',
  );
}
