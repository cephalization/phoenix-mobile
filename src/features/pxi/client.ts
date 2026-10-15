import { DefaultChatTransport } from 'ai';
import * as Crypto from 'expo-crypto';
import { fetch as expoFetch } from 'expo/fetch';

import { assertBearerRequestTarget } from '@/features/auth/oauth';
import { getAuthorizationHeaders } from '@/features/auth/session';
import type { PhoenixInstance } from '@/types/instance';

import { createAgentSession, isAgentSessionConflict, isAgentSessionStaleError } from './sessions';
import type { ModelSelection, PxiChatRequest, PxiContext, PxiMessage } from './types';

export function createPxiId(prefix = 'pxi'): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Transcript message ids must be UUIDs: Phoenix streams a turn with any id but
 * fails to persist it otherwise (observed live against 20.0.0).
 */
export function createPxiMessageId(): string {
  return Crypto.randomUUID();
}

export function buildAgentSessionChatUrl(baseUrl: string, agentSessionId: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/v1/agent_sessions/${encodeURIComponent(agentSessionId)}/chat`;
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

export function buildPxiContexts(extraContexts: PxiContext[] = []): PxiContext[] {
  return [
    {
      type: 'app',
      currentDateTime: toLocalISOWithOffset(),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    },
    { type: 'web_access', enabled: true },
    { type: 'subagents', enabled: true },
    ...extraContexts,
  ];
}

export function buildPxiRequest({
  chatId,
  contexts = [],
  messages,
  model,
}: {
  chatId: string;
  contexts?: PxiContext[];
  messages: PxiMessage[];
  model: ModelSelection;
}): PxiChatRequest {
  const message = messages.at(-1);

  if (!message || message.role !== 'user') {
    throw new Error('A PXI chat send requires a trailing user message.');
  }

  return {
    id: chatId,
    trigger: 'submit-message',
    headless: true,
    recordLocalTraces: true,
    exportRemoteTraces: false,
    instrumentUserId: false,
    editPermission: 'manual',
    contexts: buildPxiContexts(contexts),
    model,
    message,
    // The message before the trailing user message is the persisted tail this
    // client has rendered; the server rejects the send with
    // `agent_session_messages_stale` when another client appended since.
    lastMessageId: messages.at(-2)?.id ?? null,
  };
}

export function buildInstanceHeaders(instance: PhoenixInstance): Promise<Record<string, string>> {
  return getAuthorizationHeaders(instance);
}

export function createPxiTransport({
  agentSessionId,
  chatId,
  contexts,
  ephemeral = false,
  instance,
  model,
  onAgentSessionCreated,
}: {
  /** Existing server session to continue; omitted for a new chat, which is created on the first send. */
  agentSessionId?: string;
  chatId: string;
  contexts?: PxiContext[];
  /** Whether a lazily created session should expire after inactivity (contextual action runs). */
  ephemeral?: boolean;
  instance: PhoenixInstance;
  model: ModelSelection;
  onAgentSessionCreated?: (agentSessionId: string) => void;
}) {
  let sentAccessToken: string | undefined;

  const streamFetch: typeof globalThis.fetch = async (input, init) => {
    if (instance.auth.type === 'oauth2') assertBearerRequestTarget(instance, input);

    const requestInit: RequestInit = { ...init };

    if (instance.auth.type === 'oauth2') requestInit.redirect = 'error';
    const response = await expoFetch(input, requestInit);

    if (response.status === 401 && instance.auth.type === 'oauth2') {
      // A streaming POST is never replayed. Coordinate one forced rotation so
      // a later explicit user retry starts with fresh credentials, then return
      // the original HTTP response so AI SDK preserves its status and detail.
      try {
        await getAuthorizationHeaders(instance, true, sentAccessToken);
      } catch {
        throw new Error(
          'Phoenix streaming request failed with HTTP 401. Sign in again before retrying.',
        );
      }
    }

    return response;
  };

  // The server session is created lazily on the first send and reused for the
  // rest of the chat. A failed creation clears the cached promise so a retry
  // can create it instead of being stuck on the rejection.
  let agentSessionIdPromise: Promise<string> | null = agentSessionId
    ? Promise.resolve(agentSessionId)
    : null;

  const resolveAgentSessionId = (): Promise<string> => {
    agentSessionIdPromise ??= (async () => {
      try {
        const createdId = await createAgentSession(instance, { ephemeral, model });
        onAgentSessionCreated?.(createdId);

        return createdId;
      } catch (error) {
        agentSessionIdPromise = null;
        throw error;
      }
    })();

    return agentSessionIdPromise;
  };

  return new DefaultChatTransport<PxiMessage>({
    // Placeholder only: prepareSendMessagesRequest overrides the URL with the
    // resolved server session id on every send.
    api: buildAgentSessionChatUrl(instance.baseUrl, agentSessionId ?? 'pending'),
    headers: async () => {
      const headers = await buildInstanceHeaders(instance);
      sentAccessToken = headers.Authorization?.replace(/^Bearer\s+/i, '');

      return headers;
    },
    fetch: streamFetch,
    prepareSendMessagesRequest: async ({ messages }) => ({
      api: buildAgentSessionChatUrl(instance.baseUrl, await resolveAgentSessionId()),
      body: buildPxiRequest({ chatId, contexts, messages, model }),
    }),
  });
}

export function formatPxiError(error: Error): string {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();

  if (isAgentSessionConflict(error, 'agent_session_busy')) {
    return 'Another PXI client is answering in this chat. Wait for it to finish, then reload.';
  }

  if (isAgentSessionStaleError(error)) {
    return 'This chat changed on the server. Reload it to continue.';
  }

  if (normalized.includes('abort')) return 'Response stopped.';

  if (normalized.includes('401') || normalized.includes('403')) {
    return 'Phoenix rejected this connection. Check the instance authentication.';
  }

  if (normalized.includes('model') || normalized.includes('credential')) {
    return 'The selected model is unavailable. Configure it in Phoenix Settings or choose another model.';
  }

  if (
    normalized.includes('network') ||
    normalized.includes('fetch') ||
    normalized.includes('connection')
  ) {
    return 'Could not reach Phoenix. Check the instance address and network, then try again.';
  }

  return message || 'PXI could not complete this response.';
}
