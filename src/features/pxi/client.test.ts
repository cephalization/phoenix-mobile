import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { JsonValue } from '@/lib/json';
import type { PhoenixInstance } from '@/types/instance';

import {
  buildAgentSessionChatUrl,
  buildPxiRequest,
  createPxiTransport,
  formatPxiError,
} from './client';
import type { ModelSelection, PxiMessage } from './types';

// The stream is sent through expo/fetch (a native module); session creation
// goes through the global fetch, which is stubbed per test.
const expoFetch = vi.hoisted(() => vi.fn<typeof globalThis.fetch>());

vi.mock('expo/fetch', () => ({ fetch: expoFetch }));

vi.mock('expo-crypto', () => ({}));

vi.mock('expo-secure-store', () => ({}));

const model: ModelSelection = {
  modelName: 'claude-opus-4-8',
  provider: 'ANTHROPIC',
  providerType: 'builtin',
};

const instance: PhoenixInstance = {
  auth: { type: 'none' },
  baseUrl: 'http://phoenix.local:6006',
  createdAt: '2026-08-11T00:00:00.000Z',
  id: 'instance-1',
  name: 'Phoenix',
};

const fetchMock = vi.fn<typeof fetch>();

function userMessage(id: string, text: string): PxiMessage {
  return { id, parts: [{ type: 'text', text }], role: 'user' };
}

function jsonResponse(payload: JsonValue): Response {
  return new Response(JSON.stringify(payload), {
    headers: { 'Content-Type': 'application/json' },
  });
}

function sessionCreated(id: string): Response {
  return jsonResponse({ data: { id } });
}

function streamResponse(): Response {
  return new Response('data: {"type":"start"}\n\ndata: {"type":"finish"}\n\n', {
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

function send(transport: ReturnType<typeof createPxiTransport>, messages: PxiMessage[]) {
  return transport.sendMessages({
    abortSignal: undefined,
    chatId: 'chat-1',
    messageId: undefined,
    messages,
    trigger: 'submit-message',
  });
}

function requestUrl(mock: typeof expoFetch, call: number): string {
  return String(mock.mock.calls.at(call)?.[0]);
}

describe('agent session chat requests', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    expoFetch.mockReset();
    expoFetch.mockImplementation(async () => streamResponse());
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('builds the chat URL from the instance base URL and session id', () => {
    expect(buildAgentSessionChatUrl('http://phoenix.local:6006/', 'QWdlbnRTZXNzaW9uOjE=')).toBe(
      'http://phoenix.local:6006/v1/agent_sessions/QWdlbnRTZXNzaW9uOjE%3D/chat',
    );
  });

  it('sends the trailing user message with the persisted tail as lastMessageId', () => {
    const request = buildPxiRequest({
      chatId: 'chat-1',
      messages: [
        userMessage('m1', 'first'),
        { id: 'm2', parts: [{ type: 'text', text: 'reply' }], role: 'assistant' },
        userMessage('m3', 'second'),
      ],
      model,
    });

    expect(request.headless).toBe(true);
    expect(request.message.id).toBe('m3');
    expect(request.lastMessageId).toBe('m2');
    expect(request.recordLocalTraces).toBe(true);
    expect(request.model).toEqual(model);
  });

  it('omits lastMessageId for the first message of a session', () => {
    const request = buildPxiRequest({
      chatId: 'chat-1',
      messages: [userMessage('m1', 'hello')],
      model,
    });

    expect(request.lastMessageId).toBeNull();
  });

  it('rejects sends without a trailing user message', () => {
    expect(() => buildPxiRequest({ chatId: 'chat-1', messages: [], model })).toThrow(
      'trailing user message',
    );
    expect(() =>
      buildPxiRequest({
        chatId: 'chat-1',
        messages: [{ id: 'm1', parts: [{ type: 'text', text: 'reply' }], role: 'assistant' }],
        model,
      }),
    ).toThrow('trailing user message');
  });

  it('creates the server session once on the first send and reuses it', async () => {
    fetchMock.mockResolvedValue(sessionCreated('QWdlbnRTZXNzaW9uOjc='));
    const onAgentSessionCreated = vi.fn<(agentSessionId: string) => void>();

    const transport = createPxiTransport({
      chatId: 'chat-1',
      ephemeral: true,
      instance,
      model,
      onAgentSessionCreated,
    });

    await send(transport, [userMessage('m1', 'hello')]);
    await send(transport, [userMessage('m1', 'hello'), userMessage('m2', 'again')]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [creationUrl, creationInit] = fetchMock.mock.calls.at(0)!;
    expect(creationUrl).toBe('http://phoenix.local:6006/v1/agent_sessions');
    expect(creationInit?.method).toBe('POST');
    expect(JSON.parse(String(creationInit?.body))).toEqual({
      title: '',
      is_ephemeral: true,
      model,
    });

    const chatUrl = 'http://phoenix.local:6006/v1/agent_sessions/QWdlbnRTZXNzaW9uOjc%3D/chat';
    expect(expoFetch).toHaveBeenCalledTimes(2);
    expect(requestUrl(expoFetch, 0)).toBe(chatUrl);
    expect(requestUrl(expoFetch, 1)).toBe(chatUrl);
    expect(JSON.parse(String(expoFetch.mock.calls.at(1)?.[1]?.body))).toMatchObject({
      lastMessageId: 'm1',
      message: { id: 'm2' },
    });
    expect(onAgentSessionCreated).toHaveBeenCalledExactlyOnceWith('QWdlbnRTZXNzaW9uOjc=');
  });

  it('retries session creation after a failed first send', async () => {
    fetchMock
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(sessionCreated('QWdlbnRTZXNzaW9uOjg='));

    const transport = createPxiTransport({ chatId: 'chat-1', instance, model });

    await expect(send(transport, [userMessage('m1', 'hello')])).rejects.toThrow('offline');
    expect(expoFetch).not.toHaveBeenCalled();

    await send(transport, [userMessage('m1', 'hello')]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(requestUrl(expoFetch, 0)).toContain('QWdlbnRTZXNzaW9uOjg%3D');
  });

  it('continues an existing server session without creating a new one', async () => {
    const transport = createPxiTransport({
      agentSessionId: 'QWdlbnRTZXNzaW9uOjk=',
      chatId: 'chat-1',
      instance,
      model,
    });

    await send(transport, [userMessage('m1', 'hello')]);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(requestUrl(expoFetch, 0)).toContain('QWdlbnRTZXNzaW9uOjk%3D');
  });

  it('formats agent session conflicts ahead of generic error heuristics', () => {
    expect(formatPxiError(new Error('HTTP 409. {"code":"agent_session_busy"}'))).toContain(
      'Another PXI client',
    );
    expect(
      formatPxiError(new Error('HTTP 409. {"code":"agent_session_messages_stale"}')),
    ).toContain('Reload');
    expect(formatPxiError(new Error('HTTP 409. {"code":"agent_session_model_stale"}'))).toContain(
      'Reload',
    );
  });
});
