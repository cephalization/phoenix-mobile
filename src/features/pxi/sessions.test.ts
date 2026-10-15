import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { JsonValue } from '@/lib/json';
import type { PhoenixInstance } from '@/types/instance';

import {
  createAgentSession,
  getAgentSession,
  isAgentSessionConflict,
  isAgentSessionStaleError,
  listAgentSessions,
} from './sessions';
import type { ModelSelection } from './types';

vi.mock('expo-crypto', () => ({}));

vi.mock('expo-secure-store', () => ({}));

const model: ModelSelection = {
  modelName: 'claude-opus-4-8',
  provider: 'ANTHROPIC',
  providerType: 'builtin',
};

// An unauthenticated instance sends its requests straight through the global
// fetch, which each test stubs.
const instance: PhoenixInstance = {
  auth: { type: 'none' },
  baseUrl: 'http://phoenix.local:6006',
  createdAt: '2026-08-11T00:00:00.000Z',
  id: 'instance-1',
  name: 'Phoenix',
};

const fetchMock = vi.fn<typeof fetch>();

function jsonResponse(payload: JsonValue, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    headers: { 'Content-Type': 'application/json' },
    status,
  });
}

const summaryWire = {
  created_at: '2026-08-11T01:00:00Z',
  is_ephemeral: false,
  title: 'Trace latency triage',
  updated_at: '2026-08-11T02:00:00Z',
};

describe('agent session API', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('creates a session and returns the server id', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: { id: 'QWdlbnRTZXNzaW9uOjE=' } }));
    await expect(createAgentSession(instance, { ephemeral: true, model })).resolves.toBe(
      'QWdlbnRTZXNzaW9uOjE=',
    );
    const [url, init] = fetchMock.mock.calls.at(-1)!;
    expect(url).toBe('http://phoenix.local:6006/v1/agent_sessions');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({ title: '', is_ephemeral: true, model });
  });

  it('pages through the session listing until the cursor is exhausted', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ data: [{ ...summaryWire, id: 's1' }], next_cursor: 'cursor-2' }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: [{ ...summaryWire, id: 's2', is_ephemeral: true }],
          next_cursor: null,
        }),
      );
    const sessions = await listAgentSessions(instance);
    expect(sessions.map((session) => session.id)).toEqual(['s1', 's2']);
    expect(sessions[1].isEphemeral).toBe(true);
    const [secondUrl] = fetchMock.mock.calls.at(-1)!;
    expect(String(secondUrl)).toContain('cursor=cursor-2');
  });

  it('assembles a session with its full transcript across message pages', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          data: { ...summaryWire, id: 's1', is_active: false, last_message_id: 'm2', model },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: [{ id: 'm1', parts: [{ type: 'text', text: 'hello' }], role: 'user' }],
          next_cursor: 'cursor-2',
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: [{ id: 'm2', parts: [{ type: 'text', text: 'hi' }], role: 'assistant' }],
          next_cursor: null,
        }),
      );
    const session = await getAgentSession(instance, 's1');
    expect(session.model).toEqual(model);
    expect(session.isActive).toBe(false);
    expect(session.messages.map((message) => message.id)).toEqual(['m1', 'm2']);
  });

  it('rejects HTML responses from servers without the agent session routes', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('<!DOCTYPE html>', {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
        status: 200,
      }),
    );
    await expect(listAgentSessions(instance)).rejects.toThrow('Phoenix 20.0.0 or newer');
  });

  it('keeps 409 conflict codes recognizable in thrown errors', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ code: 'agent_session_model_stale', message: 'Model changed.' }, 409),
    );

    const creation = createAgentSession(instance, { ephemeral: false, model });

    await expect(creation).rejects.toThrow('HTTP 409');
    await expect(creation).rejects.toSatisfy(isAgentSessionStaleError);
    await expect(creation).rejects.toSatisfy(
      (error: Error) => !isAgentSessionConflict(error, 'agent_session_busy'),
    );
  });
});
