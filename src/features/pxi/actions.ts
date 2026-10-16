import type { BuiltInProvider, ModelSelection, PxiContext } from './types';

/**
 * Contextual PXI actions run a predetermined prompt in the PXI action sheet.
 * Each action declares the Phoenix context payloads it attaches and the exact
 * prompt it executes, so screens only pass identifiers through route params.
 */
export type PxiActionKey = 'investigate-session';

/** Parameters the PXI action route and the PXI pane accept; unknown actions resolve to null. */
export type PxiActionRouteParams = {
  action: string;
  id: string;
  modelName?: string;
  modelProvider?: BuiltInProvider;
  modelProviderId?: string;
  modelProviderType?: string;
  projectId?: string;
  sessionId?: string;
  sessionNodeId?: string;
};

/** A fully specified session investigation request. */
export type PxiActionParams = PxiActionRouteParams & {
  action: PxiActionKey;
  modelProviderType?: ModelSelection['providerType'];
  projectId: string;
  sessionId: string;
  sessionNodeId: string;
};

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

// Phoenix 20.11.0 removed PXI's built-in `write_span_note` tool. Headless turns
// now write span notes through the in-process Phoenix MCP toolset, whose
// `createSpanNote` operation (`POST /v1/span_notes`) accepts a caller identifier
// and upserts per span. The run therefore requires 20.11.0 or newer.
const INVESTIGATE_SESSION_MINIMUM = [20, 11, 0] as const;

/** Identifier stamped on every note PXI writes; the session screen filters on it. */
export const PXI_NOTE_IDENTIFIER = 'pxi';

function buildInvestigateSessionPrompt(sessionId: string, projectNodeId: string): string {
  return [
    `Perform open coding on the Phoenix session with session ID \`${sessionId}\` to prepare a human reviewer who will annotate it next.`,
    '',
    `1. Read the session with the Phoenix REST tools through \`execute\` and \`call_tool\`, not with SQL: \`getSession\` with \`session_identifier\` \`${sessionId}\` lists the session’s traces in order; \`getSpans\` with \`project_identifier\` \`${projectNodeId}\`, \`trace_id\` set to those trace IDs, and \`parent_id\` \`null\` returns each turn’s root span, whose \`context.span_id\` is the span ID to annotate and whose \`attributes\` hold the turn’s \`input.value\` and \`output.value\`. \`call_tool\` returns decoded JSON objects; never pass its result to \`json.loads\`. Read every turn’s input and output in full.`,
    '2. Open-code the transcript: record specific, evidence-grounded observations such as unmet user goals, unexpected model behavior, tool misuse, factual errors, tone problems, or latency and error signals. Let codes emerge from the data instead of forcing a fixed rubric.',
    `3. For every turn with at least one notable observation, write exactly one note on that turn’s root span with the Phoenix \`createSpanNote\` tool (POST /v1/span_notes), passing \`{"data": {"span_id": "<root span OpenTelemetry span id>", "note": "<note text>", "identifier": "${PXI_NOTE_IDENTIFIER}"}}\`. The identifier must be exactly \`${PXI_NOTE_IDENTIFIER}\`: it is how reviewers find your notes, and it makes the note replace any previous PXI note on the same span, so write the complete note in a single call. Begin each note with a single-sentence code summary of the turn’s key finding, then the supporting evidence with short transcript quotes. Keep the note self-contained. Skip turns that need no note.`,
    '4. After the notes are written, reply with a short summary for the reviewer: the main codes you observed and anything they should weigh before annotating.',
  ].join('\n');
}

export function resolvePxiAction(
  params: Record<string, string | undefined>,
): ResolvedPxiAction | null {
  if (params.action === 'investigate-session') {
    const projectNodeId = params.projectId?.trim();
    const sessionNodeId = params.sessionNodeId?.trim();
    const sessionId = params.sessionId?.trim();

    if (!projectNodeId || !sessionNodeId || !sessionId) return null;

    return {
      key: 'investigate-session',
      title: 'Investigate session',
      brief:
        'PXI is open coding this session and saving its findings as PXI notes on the conversation turns.',
      prompt: buildInvestigateSessionPrompt(sessionId, projectNodeId),
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
