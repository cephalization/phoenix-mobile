import { describe, expect, it, vi } from 'vitest';

import type { ResolvedPxiAction } from './actions';
import { createPxiInvestigationKey, usePxiInvestigationStore } from './investigation';
import type { ModelSelection } from './types';

vi.mock('@ai-sdk/react', () => ({
  Chat: class {
    init: Record<string, unknown>;
    sendMessage = vi.fn(async () => undefined);
    stop = vi.fn(async () => undefined);
    constructor(init: Record<string, unknown>) {
      this.init = init;
    }
  },
}));
vi.mock('./client', () => ({
  createPxiId: (prefix: string) => `${prefix}-fixed`,
  createPxiTransport: vi.fn(() => ({})),
}));
vi.mock('@/lib/haptics', () => ({ haptics: { error: vi.fn(), success: vi.fn() } }));

const action: ResolvedPxiAction = {
  key: 'investigate-session',
  title: 'Investigate session',
  brief: 'brief',
  prompt: 'perform open coding',
  contexts: [{ type: 'session', projectNodeId: 'proj', sessionNodeId: 'sess' }],
  minimumVersion: [17, 25, 0],
  capability: 'PXI session investigation',
};
const instance = { id: 'instance-1' } as Parameters<
  ReturnType<typeof usePxiInvestigationStore.getState>['startRun']
>[0]['instance'];
const model: ModelSelection = { modelName: 'claude-opus-4-8', provider: 'ANTHROPIC', providerType: 'builtin' };

type MockedChat = { init: { onFinish: (result: Record<string, boolean>) => void }; sendMessage: ReturnType<typeof vi.fn> };

describe('pxi investigation runs', () => {
  it('keys runs by action, instance, project, and session without collisions', () => {
    const keys = [
      createPxiInvestigationKey('investigate-session', 'i', 'p', 's'),
      createPxiInvestigationKey('investigate-session', 'i', 'p', 's2'),
      createPxiInvestigationKey('investigate-session', 'i', 'p2', 's'),
      createPxiInvestigationKey('other-action', 'i', 'p', 's'),
    ];
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('starts a run, sends the prompt, and settles through the chat callbacks', () => {
    const onSettled = vi.fn();
    const key = createPxiInvestigationKey('investigate-session', 'instance-1', 'proj', 'sess');
    usePxiInvestigationStore.getState().startRun({ action, instance, key, model, onSettled });

    const run = usePxiInvestigationStore.getState().runs[key];
    expect(run.status).toBe('running');
    expect(run.model).toEqual(model);
    const chat = run.chat as unknown as MockedChat;
    expect(chat.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ parts: [{ type: 'text', text: 'perform open coding' }], role: 'user' })
    );

    chat.init.onFinish({ isAbort: true, isDisconnect: false, isError: false });
    expect(usePxiInvestigationStore.getState().runs[key].status).toBe('stopped');
    expect(onSettled).not.toHaveBeenCalled();

    usePxiInvestigationStore.getState().markRunning(key);
    expect(usePxiInvestigationStore.getState().runs[key].status).toBe('running');

    chat.init.onFinish({ isAbort: false, isDisconnect: false, isError: false });
    expect(usePxiInvestigationStore.getState().runs[key].status).toBe('done');
    expect(onSettled).toHaveBeenCalledTimes(1);

    usePxiInvestigationStore.getState().clearRun(key);
    expect(usePxiInvestigationStore.getState().runs[key]).toBeUndefined();
  });

  it('ignores callbacks from a replaced run', () => {
    const key = createPxiInvestigationKey('investigate-session', 'instance-1', 'proj', 'replaced');
    usePxiInvestigationStore.getState().startRun({ action, instance, key, model, onSettled: vi.fn() });
    const first = usePxiInvestigationStore.getState().runs[key].chat as unknown as MockedChat;
    usePxiInvestigationStore.getState().startRun({ action, instance, key, model, onSettled: vi.fn() });

    first.init.onFinish({ isAbort: false, isDisconnect: false, isError: true });
    expect(usePxiInvestigationStore.getState().runs[key].status).toBe('running');
  });
});
