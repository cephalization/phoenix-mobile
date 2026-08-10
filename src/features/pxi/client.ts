import { DefaultChatTransport } from 'ai';
import { fetch as expoFetch } from 'expo/fetch';

import { assertBearerRequestTarget } from '@/features/auth/oauth';
import { getAuthorizationHeaders } from '@/features/auth/session';
import type { PhoenixInstance } from '@/types/instance';

import type { ModelSelection, PxiChatRequest, PxiContext, PxiMessage } from './types';

export function createPxiId(prefix = 'pxi'): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function buildServerAgentChatUrl(baseUrl: string, sessionId: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/agents/server/sessions/${encodeURIComponent(sessionId)}/chat`;
}

export function toLocalISOWithOffset(date = new Date()): string {
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const absoluteOffsetMinutes = Math.abs(offsetMinutes);
  const hours = String(Math.floor(absoluteOffsetMinutes / 60)).padStart(2, '0');
  const minutes = String(absoluteOffsetMinutes % 60).padStart(2, '0');
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return `${localDate.toISOString().slice(0, -1)}${sign}${hours}:${minutes}`;
}

export function buildPxiContexts(): PxiContext[] {
  return [
    {
      type: 'app',
      currentDateTime: toLocalISOWithOffset(),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    },
    { type: 'graphql', mutationsEnabled: false },
    { type: 'web_access', enabled: true },
    { type: 'subagents', enabled: true },
  ];
}

export function buildPxiRequest({
  messages,
  model,
  sessionId,
}: {
  messages: PxiMessage[];
  model: ModelSelection;
  sessionId: string;
}): PxiChatRequest {
  return {
    id: sessionId,
    messages,
    trigger: 'submit-message',
    ingestTraces: true,
    exportRemoteTraces: false,
    attachUserId: false,
    editPermission: 'manual',
    contexts: buildPxiContexts(),
    model,
  };
}

export function buildInstanceHeaders(instance: PhoenixInstance): Promise<Record<string, string>> {
  return getAuthorizationHeaders(instance);
}

export function createPxiTransport({
  instance,
  model,
  sessionId,
}: {
  instance: PhoenixInstance;
  model: ModelSelection;
  sessionId: string;
}) {
  let sentAccessToken: string | undefined;
  const streamFetch: typeof globalThis.fetch = async (input, init) => {
    if (instance.auth.type === 'oauth2') assertBearerRequestTarget(instance, input);
    const response = await (expoFetch as unknown as typeof globalThis.fetch)(input, {
      ...init,
      ...(instance.auth.type === 'oauth2' ? { redirect: 'error' as const } : {}),
    });
    if (response.status === 401 && instance.auth.type === 'oauth2') {
      // A streaming POST is never replayed. Coordinate one forced rotation so
      // a later explicit user retry starts with fresh credentials, then return
      // the original HTTP response so AI SDK preserves its status and detail.
      try {
        await getAuthorizationHeaders(instance, true, sentAccessToken);
      } catch {
        throw new Error('Phoenix streaming request failed with HTTP 401. Sign in again before retrying.');
      }
    }
    return response;
  };
  return new DefaultChatTransport<PxiMessage>({
    api: buildServerAgentChatUrl(instance.baseUrl, sessionId),
    headers: async () => {
      const headers = await buildInstanceHeaders(instance);
      sentAccessToken = headers.Authorization?.replace(/^Bearer\s+/i, '');
      return headers;
    },
    fetch: streamFetch,
    prepareSendMessagesRequest: ({ messages }) => ({
      body: buildPxiRequest({ messages, model, sessionId }),
    }),
  });
}

export function formatPxiError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();

  if (normalized.includes('abort')) return 'Response stopped.';
  if (normalized.includes('401') || normalized.includes('403')) {
    return 'Phoenix rejected this connection. Check the instance authentication.';
  }
  if (normalized.includes('model') || normalized.includes('credential')) {
    return 'The selected model is unavailable. Configure it in Phoenix Settings or choose another model.';
  }
  if (normalized.includes('network') || normalized.includes('fetch') || normalized.includes('connection')) {
    return 'Could not reach Phoenix. Check the instance address and network, then try again.';
  }
  return message || 'PXI could not complete this response.';
}
