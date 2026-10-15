import { describe, expect, it, vi } from 'vitest';

import { parseServerVersion, resolvePxiAction } from './actions';
import { buildPxiRequest } from './client';

vi.mock('expo/fetch', () => ({ fetch: vi.fn<typeof globalThis.fetch>() }));

vi.mock('expo-crypto', () => ({}));

vi.mock('expo-secure-store', () => ({}));

describe('contextual PXI actions', () => {
  const params = {
    action: 'investigate-session',
    id: 'instance-1',
    projectId: 'UHJvamVjdDox',
    sessionId: 'chat-42',
    sessionNodeId: 'U2Vzc2lvbjox',
  };

  it('resolves the session investigation with a session context and open-coding prompt', () => {
    const action = resolvePxiAction(params);
    expect(action).not.toBeNull();
    expect(action!.key).toBe('investigate-session');
    expect(action!.minimumVersion).toEqual([20, 11, 0]);
    expect(action!.contexts).toEqual([
      { type: 'session', projectNodeId: 'UHJvamVjdDox', sessionNodeId: 'U2Vzc2lvbjox' },
    ]);
    expect(action!.prompt).toContain('open coding');
    expect(action!.prompt).toContain('`chat-42`');
    expect(action!.prompt).toContain('createSpanNote');
    expect(action!.prompt).toContain('getSession');
    expect(action!.prompt).toContain('`UHJvamVjdDox`');
    expect(action!.prompt).toContain('json.loads');
    expect(action!.prompt).toContain('"identifier": "pxi"');
    expect(action!.prompt).not.toContain('write_span_note');
    expect(action!.prompt).toContain('single-sentence code summary');
  });

  it('rejects unknown actions and incomplete parameters', () => {
    expect(resolvePxiAction({ action: 'summarize-project' })).toBeNull();
    expect(resolvePxiAction({ ...params, sessionNodeId: undefined })).toBeNull();
    expect(resolvePxiAction({ ...params, projectId: '  ' })).toBeNull();
    expect(resolvePxiAction({ ...params, sessionId: '' })).toBeNull();
  });

  it('appends action contexts to the standard chat request contexts', () => {
    const action = resolvePxiAction(params)!;

    const request = buildPxiRequest({
      chatId: 'action-run-1',
      contexts: action.contexts,
      messages: [{ id: 'message-1', parts: [{ type: 'text', text: action.prompt }], role: 'user' }],
      model: { modelName: 'gpt-5.2', provider: 'OPENAI', providerType: 'builtin' },
    });

    expect(request.contexts.at(-1)).toEqual({
      type: 'session',
      projectNodeId: 'UHJvamVjdDox',
      sessionNodeId: 'U2Vzc2lvbjox',
    });
    // Phoenix 20.4+ deprecates the `graphql` context; headless manual turns never
    // receive mutation tools regardless, so the client must not send it.
    expect(request.contexts.map((context) => context.type)).toEqual([
      'app',
      'web_access',
      'subagents',
      'session',
    ]);
    expect(request.editPermission).toBe('manual');
  });

  it('parses dotted server versions and rejects malformed input', () => {
    expect(parseServerVersion('19.19.0')).toEqual([19, 19, 0]);
    expect(parseServerVersion(' 17.25 ')).toEqual([17, 25]);
    expect(parseServerVersion('unknown')).toBeNull();
    expect(parseServerVersion(undefined)).toBeNull();
  });
});
