import type { Types } from '@arizeai/phoenix-client';

import { authenticatedFetch } from '@/features/auth/session';
import type { PhoenixInstance } from '@/types/instance';

import type { ModelSelection, PxiMessage } from './types';

/**
 * PXI conversations are persisted server-side as agent sessions since Phoenix
 * 20.0.0 (`/v1/agent_sessions`). The server owns the transcript, titles, and
 * model selection; this module is the mobile client for those routes. Wire
 * types come from the generated `@arizeai/phoenix-client` schemas (7.16+); the
 * routes are still called directly because the client's typed `fetch` wrapper
 * cannot distinguish a pre-20.0.0 server's HTML fallback from a JSON payload.
 */
export const PXI_AGENT_SESSIONS_MINIMUM_VERSION = [20, 0, 0] as const;

const SESSION_PAGE_LIMIT = 100;

type AgentSessionSchemas = Types['V1']['components']['schemas'];

export type AgentSessionConflictCode = AgentSessionSchemas['AgentSessionConflictError']['code'];

export type PxiServerSessionSummary = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  isEphemeral: boolean;
};

export type PxiServerSession = PxiServerSessionSummary & {
  model: ModelSelection;
  /** Whether a turn is currently streaming on this session in another client. */
  isActive: boolean;
  messages: PxiMessage[];
};

type AgentSessionSummaryWire = AgentSessionSchemas['AgentSessionSummary'];

type AgentSessionDataWire = AgentSessionSchemas['AgentSessionData'];

/** Whether an error message carries an agent-session HTTP 409 conflict code. */
export function isAgentSessionConflict(error: Error, code: AgentSessionConflictCode): boolean {
  return error instanceof Error && error.message.includes(code);
}

/** Whether an error is any transcript/model staleness rejection (refetch, then retry). */
export function isAgentSessionStaleError(error: Error): boolean {
  return (
    isAgentSessionConflict(error, 'agent_session_messages_stale') ||
    isAgentSessionConflict(error, 'agent_session_model_stale')
  );
}

function buildAgentSessionUrl(baseUrl: string, path = '', query?: Record<string, string>): string {
  const search = query && Object.keys(query).length > 0 ? `?${new URLSearchParams(query)}` : '';

  return `${baseUrl.replace(/\/+$/, '')}/v1/agent_sessions${path}${search}`;
}

async function requestAgentSessionJson<Payload>(
  instance: PhoenixInstance,
  url: string,
  operation: string,
  init?: RequestInit,
): Promise<Payload> {
  const method = init?.method ?? 'GET';
  const headers: Record<string, string> = {};
  headers.Accept = 'application/json';

  if (init?.body) headers['Content-Type'] = 'application/json';

  const response = await authenticatedFetch(
    instance,
    url,
    { ...init, headers: { ...headers, ...init?.headers } },
    method === 'GET',
  );

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    // A 409 body is `{code, message}`; keep the code in the message so the
    // conflict helpers recognize it, matching how streamed sends surface it.
    throw new Error(`${operation}: HTTP ${response.status}.${detail ? ` ${detail}` : ''}`);
  }

  const contentType = response.headers.get('content-type') ?? '';

  if (!contentType.includes('application/json')) {
    // Servers before Phoenix 20.0.0 fall through to the web app for unknown
    // routes, which answers 200 with HTML instead of JSON.
    throw new Error(
      `${operation}: this Phoenix server does not provide PXI chat sessions. Phoenix ${PXI_AGENT_SESSIONS_MINIMUM_VERSION.join('.')} or newer is required.`,
    );
  }

  // SAFETY: the content-type check above guarantees a JSON body from an
  // agent-session route, and `Payload` is the wire type this module declares
  // for that route; every caller checks the `data` envelope before reading it.
  return (await response.json()) as Payload;
}

/** Create a persisted agent session and return its id. */
export async function createAgentSession(
  instance: PhoenixInstance,
  { ephemeral, model }: { ephemeral: boolean; model: ModelSelection },
): Promise<string> {
  const payload = await requestAgentSessionJson<{ data?: { id?: string } }>(
    instance,
    buildAgentSessionUrl(instance.baseUrl),
    'Phoenix could not create a PXI chat session',
    { body: JSON.stringify({ title: '', is_ephemeral: ephemeral, model }), method: 'POST' },
  );

  const id = payload.data?.id;

  if (!id) throw new Error('Phoenix returned no id for the new PXI chat session.');

  return id;
}

function toSummary(session: AgentSessionSummaryWire): PxiServerSessionSummary {
  return {
    id: session.id,
    title: session.title,
    createdAt: session.created_at,
    updatedAt: session.updated_at,
    isEphemeral: session.is_ephemeral,
  };
}

/** List the viewer's persisted sessions, most recently active first. */
export async function listAgentSessions(
  instance: PhoenixInstance,
): Promise<PxiServerSessionSummary[]> {
  const sessions: PxiServerSessionSummary[] = [];
  let cursor: string | undefined;

  do {
    const query: Record<string, string> = {};
    query.limit = String(SESSION_PAGE_LIMIT);

    if (cursor) query.cursor = cursor;

    const payload = await requestAgentSessionJson<{
      data?: AgentSessionSummaryWire[];
      next_cursor?: string | null;
    }>(
      instance,
      buildAgentSessionUrl(instance.baseUrl, '', query),
      'Phoenix could not load PXI chat sessions',
    );

    if (!payload.data) throw new Error('Phoenix returned an empty PXI sessions response.');
    sessions.push(...payload.data.map(toSummary));
    cursor = payload.next_cursor ?? undefined;
  } while (cursor);

  return sessions;
}

/** Retrieve a session's metadata and its full persisted transcript, oldest message first. */
export async function getAgentSession(
  instance: PhoenixInstance,
  sessionId: string,
): Promise<PxiServerSession> {
  const encodedId = encodeURIComponent(sessionId);

  const payload = await requestAgentSessionJson<{ data?: AgentSessionDataWire }>(
    instance,
    buildAgentSessionUrl(instance.baseUrl, `/${encodedId}`),
    'Phoenix could not open this PXI chat',
  );

  if (!payload.data) throw new Error('Phoenix returned an empty PXI session response.');
  const messages: PxiMessage[] = [];
  let cursor: string | undefined;

  do {
    const page = await requestAgentSessionJson<{
      data?: PxiMessage[];
      next_cursor?: string | null;
    }>(
      instance,
      buildAgentSessionUrl(
        instance.baseUrl,
        `/${encodedId}/messages`,
        cursor ? { cursor } : undefined,
      ),
      'Phoenix could not load this PXI chat transcript',
    );

    if (!page.data) throw new Error('Phoenix returned an empty PXI transcript response.');
    messages.push(...page.data);
    cursor = page.next_cursor ?? undefined;
  } while (cursor);

  return {
    ...toSummary(payload.data),
    model: payload.data.model,
    isActive: payload.data.is_active === true,
    messages,
  };
}

/** Move a persisted session to a different model. */
export async function patchAgentSessionModel(
  instance: PhoenixInstance,
  sessionId: string,
  model: ModelSelection,
): Promise<void> {
  await requestAgentSessionJson<{ data?: AgentSessionDataWire }>(
    instance,
    buildAgentSessionUrl(instance.baseUrl, `/${encodeURIComponent(sessionId)}`),
    'Phoenix could not change this chat’s model',
    { body: JSON.stringify({ model }), method: 'PATCH' },
  );
}
