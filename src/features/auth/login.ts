import * as WebBrowser from 'expo-web-browser';

import type { PhoenixInstance } from '@/types/instance';

import { buildAuthorizationUrl, createPkce, parseOAuthCallback, PhoenixAuthError } from './oauth';
import {
  clearOAuthTransaction,
  exchangeOAuthCode,
  loadOAuthTransaction,
  revokeAndDeleteCredentials,
  saveOAuthTransaction,
} from './session';

let callbackCompletion: Promise<PhoenixInstance> | null = null;
let inMemoryLoginOwner = false;

export function hasInMemoryOAuthLoginOwner(): boolean {
  return inMemoryLoginOwner;
}

export async function runOAuthLogin(instance: PhoenixInstance): Promise<PhoenixInstance> {
  if (instance.auth.type !== 'oauth2') throw new PhoenixAuthError('OAuth login metadata is missing.', 'invalid_server');
  if (inMemoryLoginOwner) throw new PhoenixAuthError('Another Phoenix sign-in is already active.', 'unavailable');
  inMemoryLoginOwner = true;
  try {
    return await runOwnedOAuthLogin(instance);
  } finally {
    inMemoryLoginOwner = false;
  }
}

async function runOwnedOAuthLogin(instance: PhoenixInstance): Promise<PhoenixInstance> {
  if (instance.auth.type !== 'oauth2') throw new PhoenixAuthError('OAuth login metadata is missing.', 'invalid_server');
  const oauthAuth = instance.auth;
  const oauthInstance = { ...instance, auth: oauthAuth };
  const pkce = await createPkce();
  await saveOAuthTransaction({ version: 1, instance: oauthInstance, state: pkce.state, verifier: pkce.verifier, createdAt: Date.now() });
  const authorizationUrl = buildAuthorizationUrl(oauthInstance, pkce.state, pkce.challenge);
  let result: Awaited<ReturnType<typeof WebBrowser.openAuthSessionAsync>>;
  try {
    result = await WebBrowser.openAuthSessionAsync(authorizationUrl, 'phoenixmobile://oauth/callback');
  } catch (error) {
    await clearOAuthTransaction();
    throw error;
  }
  if (result.type !== 'success') {
    await clearOAuthTransaction();
    throw new PhoenixAuthError('Phoenix sign-in was cancelled.', 'cancelled');
  }
  return completeOAuthCallback(result.url);
}

export async function completeOAuthCallback(callbackUrl: string): Promise<PhoenixInstance> {
  if (callbackCompletion) return callbackCompletion;
  callbackCompletion = complete(callbackUrl).finally(() => {
    callbackCompletion = null;
  });
  return callbackCompletion;
}

async function complete(callbackUrl: string): Promise<PhoenixInstance> {
  const transaction = await loadOAuthTransaction();
  let exchanged = false;
  try {
    const code = parseOAuthCallback(callbackUrl, transaction.state);
    await exchangeOAuthCode(transaction.instance, code, transaction.verifier);
    exchanged = true;
    return transaction.instance;
  } finally {
    try {
      await clearOAuthTransaction();
    } catch {
      if (exchanged) await revokeAndDeleteCredentials(transaction.instance).catch(() => undefined);
      throw new PhoenixAuthError('Phoenix sign-in state could not be cleared securely. Sign in again.', 'login_required');
    }
  }
}
