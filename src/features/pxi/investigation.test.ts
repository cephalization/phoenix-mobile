import type * as ExpoCrypto from 'expo-crypto';
import type * as ExpoHaptics from 'expo-haptics';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { JsonValue } from '@/lib/json';
import type { PhoenixInstance } from '@/types/instance';

import type { ResolvedPxiAction } from './actions';
import { createPxiInvestigationKey, usePxiInvestigationStore } from './investigation';
import type { ModelSelection } from './types';

// Runs drive the real Chat and transport: the ephemeral server session is
// created through the global fetch (stubbed per test) and the turn streams
// through expo/fetch (a native module).
const expoFetch = vi.hoisted(() => vi.fn<typeof globalThis.fetch>());

const notificationAsync = vi.hoisted(() =>
  vi.fn<typeof ExpoHaptics.notificationAsync>(async () => undefined),
);

vi.mock('expo/fetch', () => ({ fetch: expoFetch }));

vi.mock('expo-crypto', () => ({
  randomUUID: vi.fn<typeof ExpoCrypto.randomUUID>(() => 'a2c8e29d-0000-4000-8000-000000000001'),
}));

vi.mock('expo-secure-store', () => ({}));

vi.mock('expo-haptics', () => ({
  NotificationFeedbackType: { Error: 'error', Success: 'success', Warning: 'warning' },
  notificationAsync,
}));

const action: ResolvedPxiAction = {
  key: 'investigate-session',
  title: 'Investigate session',
  brief: 'brief',
  prompt: 'perform open coding',
  contexts: [{ type: 'session', projectNodeId: 'proj', sessionNodeId: 'sess' }],
  minimumVersion: [17, 25, 0],
  capability: 'PXI session investigation',
};

const instance: PhoenixInstance = {
  auth: { type: 'none' },
  baseUrl: 'http://phoenix.local:6006',
  createdAt: '2026-08-11T00:00:00.000Z',
  id: 'instance-1',
  name: 'Phoenix',
};

const model: ModelSelection = {
  modelName: 'claude-opus-4-8',
  provider: 'ANTHROPIC',
  providerType: 'builtin',
};

const fetchMock = vi.fn<typeof fetch>();

function jsonResponse(payload: JsonValue): Response {
  return new Response(JSON.stringify(payload), {
    headers: { 'Content-Type': 'application/json' },
  });
}

function streamResponse(): Response {
  return new Response('data: {"type":"start"}\n\ndata: {"type":"finish"}\n\n', {
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

/** A stream request that never answers until the chat aborts it. */
function pendingUntilAborted(signal: AbortSignal | null | undefined): Promise<Response> {
  return new Promise((_resolve, reject) => {
    signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
  });
}

function runStatus(key: string) {
  return usePxiInvestigationStore.getState().runs[key]?.status;
}

describe('pxi investigation runs', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockImplementation(async () =>
      jsonResponse({ data: { id: 'QWdlbnRTZXNzaW9uOjE=' } }),
    );
    expoFetch.mockReset();
    notificationAsync.mockClear();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    for (const [key, run] of Object.entries(usePxiInvestigationStore.getState().runs)) {
      run.chat.stop();
      usePxiInvestigationStore.getState().clearRun(key);
    }

    vi.unstubAllGlobals();
  });

  it('keys runs by action, instance, project, and session without collisions', () => {
    const keys = [
      createPxiInvestigationKey('investigate-session', 'i', 'p', 's'),
      createPxiInvestigationKey('investigate-session', 'i', 'p', 's2'),
      createPxiInvestigationKey('investigate-session', 'i', 'p2', 's'),
      createPxiInvestigationKey('other-action', 'i', 'p', 's'),
    ];

    expect(new Set(keys).size).toBe(keys.length);
  });

  it('starts a run, sends the prompt, and settles through the chat callbacks', async () => {
    expoFetch
      .mockImplementationOnce((_input, init) => pendingUntilAborted(init?.signal))
      .mockImplementation(async () => streamResponse());
    const onSettled = vi.fn<() => void>();
    const key = createPxiInvestigationKey('investigate-session', 'instance-1', 'proj', 'sess');
    usePxiInvestigationStore.getState().startRun({ action, instance, key, model, onSettled });

    const run = usePxiInvestigationStore.getState().runs[key];
    expect(run.status).toBe('running');
    expect(run.model).toEqual(model);

    await vi.waitFor(() => expect(expoFetch).toHaveBeenCalledTimes(1));
    expect(JSON.parse(String(expoFetch.mock.calls.at(0)?.[1]?.body))).toMatchObject({
      contexts: expect.arrayContaining(action.contexts),
      message: { parts: [{ type: 'text', text: 'perform open coding' }], role: 'user' },
    });
    expect(JSON.parse(String(fetchMock.mock.calls.at(0)?.[1]?.body))).toMatchObject({
      is_ephemeral: true,
      model,
    });

    run.chat.stop();
    await vi.waitFor(() => expect(runStatus(key)).toBe('stopped'));
    expect(onSettled).not.toHaveBeenCalled();

    // A retry replaces the stopped run with a fresh one.
    const onRetrySettled = vi.fn<() => void>();
    usePxiInvestigationStore
      .getState()
      .startRun({ action, instance, key, model, onSettled: onRetrySettled });
    expect(runStatus(key)).toBe('running');
    expect(usePxiInvestigationStore.getState().runs[key].chat).not.toBe(run.chat);

    await vi.waitFor(() => expect(runStatus(key)).toBe('done'));
    expect(onRetrySettled).toHaveBeenCalledTimes(1);
    expect(notificationAsync).toHaveBeenCalledExactlyOnceWith('success');

    usePxiInvestigationStore.getState().clearRun(key);
    expect(usePxiInvestigationStore.getState().runs[key]).toBeUndefined();
  });

  it('ignores callbacks from a replaced run', async () => {
    expoFetch.mockImplementation((_input, init) => pendingUntilAborted(init?.signal));
    const key = createPxiInvestigationKey('investigate-session', 'instance-1', 'proj', 'replaced');
    usePxiInvestigationStore
      .getState()
      .startRun({ action, instance, key, model, onSettled: vi.fn<() => void>() });
    const first = usePxiInvestigationStore.getState().runs[key].chat;
    await vi.waitFor(() => expect(expoFetch).toHaveBeenCalledTimes(1));

    // Replacing the run aborts the first chat; its settlement must not touch
    // the run that replaced it.
    usePxiInvestigationStore
      .getState()
      .startRun({ action, instance, key, model, onSettled: vi.fn<() => void>() });
    expect(usePxiInvestigationStore.getState().runs[key].chat).not.toBe(first);

    await vi.waitFor(() => expect(first.status).toBe('ready'));
    expect(runStatus(key)).toBe('running');
  });
});
