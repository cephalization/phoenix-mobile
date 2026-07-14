import { DefaultChatTransport } from 'ai';
import { fetch as expoFetch } from 'expo/fetch';

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

export function buildInstanceHeaders(instance: PhoenixInstance): Record<string, string> {
  if (instance.auth.type !== 'none') {
    throw new Error('Sign in to this Phoenix instance again before using PXI.');
  }
  return {};
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
  return new DefaultChatTransport<PxiMessage>({
    api: buildServerAgentChatUrl(instance.baseUrl, sessionId),
    headers: buildInstanceHeaders(instance),
    fetch: expoFetch as unknown as typeof globalThis.fetch,
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
