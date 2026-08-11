import type { PxiContext } from './types';

/**
 * Contextual PXI actions run a predetermined prompt in the PXI action sheet.
 * Each action declares the Phoenix context payloads it attaches and the exact
 * prompt it executes, so screens only pass identifiers through route params.
 */
export type PxiActionKey = 'investigate-session';

export type ResolvedPxiAction = {
  key: PxiActionKey;
  /** Sheet heading shown above the run. */
  title: string;
  /** One-sentence description of what PXI has been asked to do. */
  brief: string;
  /** Predetermined user message sent when the sheet opens. */
  prompt: string;
  /** Context payloads appended to the chat request. */
  contexts: PxiContext[];
  /** Minimum Phoenix server version whose PXI supports this action. */
  minimumVersion: readonly [number, number, number];
  /** Capability name used in unsupported-version copy. */
  capability: string;
};

// PXI's write_span_note tool ships with Phoenix 17.25.0, but contextual runs
// now go through the persisted agent-session chat contract from Phoenix 20.0.0.
const INVESTIGATE_SESSION_MINIMUM = [20, 0, 0] as const;

function buildInvestigateSessionPrompt(sessionId: string): string {
  return [
    `Perform open coding on the Phoenix session in your attached session context (session ID \`${sessionId}\`) to prepare a human reviewer who will annotate it next.`,
    '',
    '1. Retrieve the session conversation and read every turn’s input and output in full.',
    '2. Open-code the transcript: record specific, evidence-grounded observations such as unmet user goals, unexpected model behavior, tool misuse, factual errors, tone problems, or latency and error signals. Let codes emerge from the data instead of forcing a fixed rubric.',
    '3. For every turn with at least one notable observation, call write_span_note exactly once on that turn’s root span. Begin each note with a single-sentence code summary of the turn’s key finding, then the supporting evidence with short transcript quotes. Keep the note self-contained; a note replaces any previous PXI note on the same span, so write the complete note in a single call. Skip turns that need no note.',
    '4. After the notes are written, reply with a short summary for the reviewer: the main codes you observed and anything they should weigh before annotating.',
  ].join('\n');
}

export function resolvePxiAction(
  params: Record<string, string | undefined>
): ResolvedPxiAction | null {
  if (params.action === 'investigate-session') {
    const projectNodeId = params.projectId?.trim();
    const sessionNodeId = params.sessionNodeId?.trim();
    const sessionId = params.sessionId?.trim();
    if (!projectNodeId || !sessionNodeId || !sessionId) return null;
    return {
      key: 'investigate-session',
      title: 'Investigate session',
      brief: 'PXI is open coding this session and saving its findings as PXI notes on the conversation turns.',
      prompt: buildInvestigateSessionPrompt(sessionId),
      contexts: [{ type: 'session', projectNodeId, sessionNodeId }],
      minimumVersion: INVESTIGATE_SESSION_MINIMUM,
      capability: 'PXI session investigation',
    };
  }
  return null;
}

export function parseServerVersion(version: string | undefined): number[] | null {
  if (!version) return null;
  const parts = version.trim().split('.').map(Number);
  return parts.length > 0 && parts.every(Number.isFinite) ? parts : null;
}
