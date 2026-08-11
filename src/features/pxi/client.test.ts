import { describe, expect, it, vi } from 'vitest';

import { buildAgentSessionChatUrl, buildPxiRequest, createPxiTransport, formatPxiError } from './client';
import { createAgentSession } from './sessions';
import type { ModelSelection, PxiMessage } from './types';

vi.mock('ai', () => ({
  DefaultChatTransport: class {
    init: Record<string, unknown>;
    constructor(init: Record<string, unknown>) {
      this.init = init;
    }
  },
}));
vi.mock('expo/fetch', () => ({ fetch: vi.fn() }));
vi.mock('expo-crypto', () => ({}));
vi.mock('@/features/auth/session', () => ({ authenticatedFetch: vi.fn(), getAuthorizationHeaders: vi.fn() }));
vi.mock('./sessions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./sessions')>()),
  createAgentSession: vi.fn(),
}));

const model: ModelSelection = { modelName: 'claude-opus-4-8', provider: 'ANTHROPIC', providerType: 'builtin' };
const instance = { auth: { type: 'none' }, baseUrl: 'http://phoenix.local:6006', id: 'instance-1' } as Parameters<
  typeof createPxiTransport
>[0]['instance'];

function userMessage(id: string, text: string): PxiMessage {
  return { id, parts: [{ type: 'text', text }], role: 'user' };
}

type MockedTransport = {
  init: {
    prepareSendMessagesRequest: (options: { messages: PxiMessage[] }) => Promise<{ api: string; body: unknown }>;
  };
};

describe('agent session chat requests', () => {
  it('builds the chat URL from the instance base URL and session id', () => {
    expect(buildAgentSessionChatUrl('http://phoenix.local:6006/', 'QWdlbnRTZXNzaW9uOjE=')).toBe(
      'http://phoenix.local:6006/v1/agent_sessions/QWdlbnRTZXNzaW9uOjE%3D/chat'
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
    const request = buildPxiRequest({ chatId: 'chat-1', messages: [userMessage('m1', 'hello')], model });
    expect(request.lastMessageId).toBeNull();
  });

  it('rejects sends without a trailing user message', () => {
    expect(() => buildPxiRequest({ chatId: 'chat-1', messages: [], model })).toThrow();
    expect(() =>
      buildPxiRequest({
        chatId: 'chat-1',
        messages: [{ id: 'm1', parts: [{ type: 'text', text: 'reply' }], role: 'assistant' }],
        model,
      })
    ).toThrow();
  });

  it('creates the server session once on the first send and reuses it', async () => {
    vi.mocked(createAgentSession).mockResolvedValue('QWdlbnRTZXNzaW9uOjc=');
    const onAgentSessionCreated = vi.fn();
    const transport = createPxiTransport({
      chatId: 'chat-1',
      ephemeral: true,
      instance,
      model,
      onAgentSessionCreated,
    }) as unknown as MockedTransport;
    const first = await transport.init.prepareSendMessagesRequest({ messages: [userMessage('m1', 'hello')] });
    const second = await transport.init.prepareSendMessagesRequest({
      messages: [userMessage('m1', 'hello'), userMessage('m2', 'again')],
    });
    expect(createAgentSession).toHaveBeenCalledTimes(1);
    expect(createAgentSession).toHaveBeenCalledWith(instance, { ephemeral: true, model });
    expect(first.api).toBe('http://phoenix.local:6006/v1/agent_sessions/QWdlbnRTZXNzaW9uOjc%3D/chat');
    expect(second.api).toBe(first.api);
    expect(onAgentSessionCreated).toHaveBeenCalledExactlyOnceWith('QWdlbnRTZXNzaW9uOjc=');
  });

  it('retries session creation after a failed first send', async () => {
    vi.mocked(createAgentSession)
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce('QWdlbnRTZXNzaW9uOjg=');
    const transport = createPxiTransport({ chatId: 'chat-1', instance, model }) as unknown as MockedTransport;
    await expect(
      transport.init.prepareSendMessagesRequest({ messages: [userMessage('m1', 'hello')] })
    ).rejects.toThrow('offline');
    const retried = await transport.init.prepareSendMessagesRequest({ messages: [userMessage('m1', 'hello')] });
    expect(retried.api).toContain('QWdlbnRTZXNzaW9uOjg%3D');
  });

  it('continues an existing server session without creating a new one', async () => {
    vi.mocked(createAgentSession).mockClear();
    const transport = createPxiTransport({
      agentSessionId: 'QWdlbnRTZXNzaW9uOjk=',
      chatId: 'chat-1',
      instance,
      model,
    }) as unknown as MockedTransport;
    const request = await transport.init.prepareSendMessagesRequest({ messages: [userMessage('m1', 'hello')] });
    expect(createAgentSession).not.toHaveBeenCalled();
    expect(request.api).toContain('QWdlbnRTZXNzaW9uOjk%3D');
  });

  it('formats agent session conflicts ahead of generic error heuristics', () => {
    expect(formatPxiError(new Error('HTTP 409. {"code":"agent_session_busy"}'))).toContain('Another PXI client');
    expect(formatPxiError(new Error('HTTP 409. {"code":"agent_session_messages_stale"}'))).toContain('Reload');
    expect(formatPxiError(new Error('HTTP 409. {"code":"agent_session_model_stale"}'))).toContain('Reload');
  });
});
