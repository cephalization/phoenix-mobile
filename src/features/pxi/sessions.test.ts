import { describe, expect, it, vi } from 'vitest';

import { authenticatedFetch } from '@/features/auth/session';

import {
  createAgentSession,
  getAgentSession,
  isAgentSessionConflict,
  isAgentSessionStaleError,
  listAgentSessions,
} from './sessions';
import type { ModelSelection } from './types';

vi.mock('@/features/auth/session', () => ({ authenticatedFetch: vi.fn() }));

const model: ModelSelection = { modelName: 'claude-opus-4-8', provider: 'ANTHROPIC', providerType: 'builtin' };
const instance = { auth: { type: 'none' }, baseUrl: 'http://phoenix.local:6006', id: 'instance-1' } as Parameters<
  typeof listAgentSessions
>[0];

function jsonResponse(payload: unknown, status = 200): Response {
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
  it('creates a session and returns the server id', async () => {
    vi.mocked(authenticatedFetch).mockResolvedValueOnce(jsonResponse({ data: { id: 'QWdlbnRTZXNzaW9uOjE=' } }));
    await expect(createAgentSession(instance, { ephemeral: true, model })).resolves.toBe('QWdlbnRTZXNzaW9uOjE=');
    const [, url, init] = vi.mocked(authenticatedFetch).mock.calls.at(-1)!;
    expect(url).toBe('http://phoenix.local:6006/v1/agent_sessions');
    expect(JSON.parse(String(init?.body))).toEqual({ title: '', is_ephemeral: true, model });
  });

  it('pages through the session listing until the cursor is exhausted', async () => {
    vi.mocked(authenticatedFetch)
      .mockResolvedValueOnce(jsonResponse({ data: [{ ...summaryWire, id: 's1' }], next_cursor: 'cursor-2' }))
      .mockResolvedValueOnce(jsonResponse({ data: [{ ...summaryWire, id: 's2', is_ephemeral: true }], next_cursor: null }));
    const sessions = await listAgentSessions(instance);
    expect(sessions.map((session) => session.id)).toEqual(['s1', 's2']);
    expect(sessions[1].isEphemeral).toBe(true);
    const secondUrl = vi.mocked(authenticatedFetch).mock.calls.at(-1)![1];
    expect(String(secondUrl)).toContain('cursor=cursor-2');
  });

  it('assembles a session with its full transcript across message pages', async () => {
    vi.mocked(authenticatedFetch)
      .mockResolvedValueOnce(jsonResponse({
        data: { ...summaryWire, id: 's1', is_active: false, last_message_id: 'm2', model },
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: [{ id: 'm1', parts: [{ type: 'text', text: 'hello' }], role: 'user' }],
        next_cursor: 'cursor-2',
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: [{ id: 'm2', parts: [{ type: 'text', text: 'hi' }], role: 'assistant' }],
        next_cursor: null,
      }));
    const session = await getAgentSession(instance, 's1');
    expect(session.model).toEqual(model);
    expect(session.isActive).toBe(false);
    expect(session.messages.map((message) => message.id)).toEqual(['m1', 'm2']);
  });

  it('rejects HTML responses from servers without the agent session routes', async () => {
    vi.mocked(authenticatedFetch).mockResolvedValueOnce(
      new Response('<!DOCTYPE html>', { headers: { 'Content-Type': 'text/html; charset=utf-8' }, status: 200 })
    );
    await expect(listAgentSessions(instance)).rejects.toThrow('Phoenix 20.0.0 or newer');
  });

  it('keeps 409 conflict codes recognizable in thrown errors', async () => {
    vi.mocked(authenticatedFetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ code: 'agent_session_model_stale' }), {
        headers: { 'Content-Type': 'application/json' },
        status: 409,
      })
    );
    const failure = await createAgentSession(instance, { ephemeral: false, model }).catch((error: unknown) => error);
    expect(isAgentSessionStaleError(failure)).toBe(true);
    expect(isAgentSessionConflict(failure, 'agent_session_busy')).toBe(false);
  });
});
