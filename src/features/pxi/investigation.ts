import { Chat } from '@ai-sdk/react';
import { create } from 'zustand';

import { haptics } from '@/lib/haptics';
import type { PhoenixInstance } from '@/types/instance';

import type { ResolvedPxiAction } from './actions';
import { createPxiId, createPxiMessageId, createPxiTransport } from './client';
import type { ModelSelection, PxiMessage } from './types';

/**
 * Contextual PXI runs are owned here, outside any route, so a run keeps
 * streaming when the action sheet is dismissed. The sheet and the launching
 * screen are both subscribers: the sheet renders the transcript through
 * `useChat({ chat })`, screens read only the run status. Runs are memory-only;
 * the durable output is whatever PXI wrote server-side.
 */
export type PxiInvestigationStatus = 'running' | 'done' | 'stopped' | 'error';

export type PxiInvestigation = {
  chat: Chat<PxiMessage>;
  model: ModelSelection;
  startedAt: number;
  status: PxiInvestigationStatus;
};

type PxiInvestigationState = {
  runs: Record<string, PxiInvestigation>;
  clearRun: (key: string) => void;
  startRun: (options: {
    action: ResolvedPxiAction;
    instance: PhoenixInstance;
    key: string;
    model: ModelSelection;
    /** Called after a fully successful run, e.g. to invalidate note queries. */
    onSettled: () => void;
  }) => void;
};

export function createPxiInvestigationKey(
  actionKey: string,
  instanceId: string,
  projectId: string,
  sessionId: string
): string {
  return JSON.stringify([actionKey, instanceId, projectId, sessionId]);
}

export const usePxiInvestigationStore = create<PxiInvestigationState>()((set, get) => ({
  runs: {},
  clearRun: (key) =>
    set((state) => {
      const { [key]: _removed, ...runs } = state.runs;
      return { runs };
    }),
  startRun: ({ action, instance, key, model, onSettled }) => {
    void get().runs[key]?.chat.stop();
    const setStatus = (status: PxiInvestigationStatus) =>
      set((state) =>
        state.runs[key]?.chat === chat
          ? { runs: { ...state.runs, [key]: { ...state.runs[key], status } } }
          : state
      );
    const runId = createPxiId('action');
    const chat: Chat<PxiMessage> = new Chat<PxiMessage>({
      id: runId,
      // Each run gets its own ephemeral server session, created on the first
      // send: the durable output is the span notes PXI writes, not the chat.
      transport: createPxiTransport({
        chatId: runId,
        contexts: action.contexts,
        ephemeral: true,
        instance,
        model,
      }),
      onError: () => {
        haptics.error();
        setStatus('error');
      },
      onFinish: ({ isAbort, isDisconnect, isError }) => {
        if (isAbort) {
          setStatus('stopped');
          return;
        }
        if (isError || isDisconnect) {
          setStatus('error');
          return;
        }
        haptics.success();
        setStatus('done');
        onSettled();
      },
    });
    set((state) => ({
      runs: {
        ...state.runs,
        [key]: { chat, model, startedAt: Date.now(), status: 'running' },
      },
    }));
    void chat
      .sendMessage({
        id: createPxiMessageId(),
        parts: [{ type: 'text', text: action.prompt }],
        role: 'user',
      })
      .catch(() => {
        // The chat instance exposes the actionable error state.
      });
  },
}));
