import { isToolUIPart } from 'ai';

import type { PxiMessage } from './types';

type PxiMessagePart = PxiMessage['parts'][number];

const INTERRUPTED_TOOL_ERROR = 'Interrupted before the tool finished.';

// The AI SDK does not finalize part states on abort, disconnect, or error, so a
// transcript captured mid-stream carries `streaming` and `input-*` states that no
// future stream will ever resolve. Persisted and restored messages must be
// terminal or the transcript renders spinners and streaming cursors forever.
function finalizePart(part: PxiMessagePart): PxiMessagePart {
  if ((part.type === 'text' || part.type === 'reasoning') && part.state === 'streaming') {
    return { ...part, state: 'done' };
  }
  if (isToolUIPart(part) && (part.state === 'input-streaming' || part.state === 'input-available')) {
    return {
      ...part,
      state: 'output-error',
      input: part.input,
      errorText: INTERRUPTED_TOOL_ERROR,
    } as PxiMessagePart;
  }
  return part;
}

export function finalizeInterruptedMessages(messages: PxiMessage[]): PxiMessage[] {
  let anyChanged = false;
  const finalized = messages.map((message) => {
    let messageChanged = false;
    const parts = message.parts.map((part) => {
      const next = finalizePart(part);
      if (next !== part) messageChanged = true;
      return next;
    });
    if (!messageChanged) return message;
    anyChanged = true;
    return { ...message, parts };
  });
  return anyChanged ? finalized : messages;
}
