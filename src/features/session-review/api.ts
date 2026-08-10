import type { PhoenixClient, Types } from '@arizeai/phoenix-client';

import { createPhoenixClient } from '@/lib/phoenix';
import type { PhoenixInstance } from '@/types/instance';

import type {
  PhoenixSpan,
  SessionAnnotation,
  SessionAnnotationConfig,
  SessionAnnotationDraft,
  SessionAnnotationWrite,
  SessionAnnotationsWrite,
  SessionData,
  SessionNoteWrite,
  SessionPage,
  SessionTurn,
  SessionTurnIO,
} from './types';

type SessionAnnotationData =
  Types['V1']['components']['schemas']['SessionAnnotationData'];

const SESSION_PAGE_SIZE = 40;
const ROOT_SPAN_BATCH_SIZE = 50;
const ANNOTATION_SESSION_BATCH_SIZE = 50;
const API_PAGE_SIZE = 100;

export const sessionReviewCompatibility = {
  sessions: [13, 5, 0] as const,
  rootSpanTraceFiltering: [13, 9, 0] as const,
  projectAnnotationConfigs: [17, 16, 0] as const,
  sessionAnnotations: [13, 5, 0] as const,
  sessionNotes: [14, 17, 0] as const,
  deterministicNoteIdentifiers: [15, 5, 0] as const,
};

export class SessionReviewCompatibilityError extends Error {
  constructor(
    public readonly capability: string,
    public readonly minimumVersion: readonly [number, number, number],
    public readonly serverVersion: readonly number[]
  ) {
    super(
      `${capability} requires Phoenix ${minimumVersion.join('.')} or newer; this server is ${serverVersion.join('.')}.`
    );
    this.name = 'SessionReviewCompatibilityError';
  }
}

export type SessionReviewValidationIssue = {
  field: 'config' | 'explanation' | 'identifier' | 'label' | 'note' | 'projectId' | 'score' | 'sessionId' | 'turns';
  message: string;
};

export class SessionReviewValidationError extends Error {
  constructor(public readonly issues: SessionReviewValidationIssue[]) {
    super(issues.map((issue) => issue.message).join(' '));
    this.name = 'SessionReviewValidationError';
  }
}

export class SessionReviewApiError extends Error {
  constructor(public readonly operation: string, cause: unknown) {
    super(`${operation}: ${formatUnknownError(cause)}`, { cause });
    this.name = 'SessionReviewApiError';
  }
}

// Keep client acquisition behind an async boundary so auth changes stay local to this module.
export async function acquireSessionReviewClient(instance: PhoenixInstance): Promise<PhoenixClient> {
  return await Promise.resolve(createPhoenixClient(instance));
}

export async function fetchSessionPage(
  instance: PhoenixInstance,
  projectId: string,
  cursor: string | null
): Promise<SessionPage> {
  return withSessionApiError('Phoenix could not load sessions', async () => {
    const client = await compatibleClient(instance, 'Session review', sessionReviewCompatibility.sessions);
    const response = await client.GET('/v1/projects/{project_identifier}/sessions', {
      params: {
        path: { project_identifier: requiredText(projectId, 'projectId', 'Project ID is required.') },
        query: { cursor, limit: SESSION_PAGE_SIZE, order: 'desc' },
      },
    });
    if (!response.data) throw new Error('The server returned an empty sessions response.');
    return { items: response.data.data, nextCursor: response.data.next_cursor };
  });
}

export async function fetchSession(
  instance: PhoenixInstance,
  sessionIdentifier: string
): Promise<SessionData> {
  return withSessionApiError('Phoenix could not load this session', async () => {
    const client = await compatibleClient(instance, 'Session detail', sessionReviewCompatibility.sessions);
    const response = await client.GET('/v1/sessions/{session_identifier}', {
      params: {
        path: {
          session_identifier: requiredText(sessionIdentifier, 'sessionId', 'Session ID is required.'),
        },
      },
    });
    if (!response.data?.data) throw new Error('The server returned an empty session response.');
    return response.data.data;
  });
}

export async function fetchSessionTurns(
  instance: PhoenixInstance,
  session: SessionData
): Promise<SessionTurn[]> {
  return withSessionApiError('Phoenix could not load session turns', async () => {
    const client = await compatibleClient(
      instance,
      'Session root-span trace filtering',
      sessionReviewCompatibility.rootSpanTraceFiltering
    );
    const rootsByTraceId = new Map<string, PhoenixSpan>();
    const traceIds = [...new Set(session.traces.map((trace) => trace.trace_id))];

    for (let index = 0; index < traceIds.length; index += ROOT_SPAN_BATCH_SIZE) {
      const batch = traceIds.slice(index, index + ROOT_SPAN_BATCH_SIZE);
      for (const span of await fetchRootSpanBatch(client, session.project_id, batch)) {
        if (span.parent_id != null || !batch.includes(span.context.trace_id)) continue;
        const current = rootsByTraceId.get(span.context.trace_id);
        if (!current || compareCanonicalRoots(span, current) < 0) {
          rootsByTraceId.set(span.context.trace_id, span);
        }
      }
    }

    return session.traces
      .map((trace): SessionTurn => {
        const rootSpan = rootsByTraceId.get(trace.trace_id);
        return {
          traceId: trace.trace_id,
          startTime: trace.start_time,
          endTime: trace.end_time,
          ...(rootSpan
            ? {
                rootSpan,
                input: extractIO(rootSpan.attributes, 'input.value', 'input.mime_type'),
                output: extractIO(rootSpan.attributes, 'output.value', 'output.mime_type'),
              }
            : {}),
        };
      })
      .sort((left, right) => left.startTime.localeCompare(right.startTime));
  });
}

export async function fetchProjectAnnotationConfigs(
  instance: PhoenixInstance,
  projectId: string
): Promise<SessionAnnotationConfig[]> {
  return withSessionApiError('Phoenix could not load project annotation configurations', async () => {
    const client = await compatibleClient(
      instance,
      'Project annotation configurations',
      sessionReviewCompatibility.projectAnnotationConfigs
    );
    const configs = new Map<string, SessionAnnotationConfig>();
    const seenCursors = new Set<string>();
    let cursor: string | null = null;

    do {
      const response = await client.GET('/v1/projects/{project_identifier}/annotation_configs', {
        params: {
          path: { project_identifier: projectId },
          query: { cursor, limit: API_PAGE_SIZE },
        },
      });
      if (!response.data) throw new Error('The server returned an empty annotation config response.');
      for (const config of response.data.data) configs.set(config.id, config);
      cursor = nextUnseenCursor(response.data.next_cursor, seenCursors);
    } while (cursor);

    return [...configs.values()];
  });
}

export async function fetchSessionAnnotations(
  instance: PhoenixInstance,
  projectId: string,
  sessionIds: readonly string[],
  annotationNames: readonly string[]
): Promise<SessionAnnotation[]> {
  const ids = [...new Set(sessionIds.map((id) => id.trim()).filter(Boolean))];
  const names = [...new Set(annotationNames.map((name) => name.trim()).filter(Boolean))];
  if (ids.length === 0 || names.length === 0) return [];

  return withSessionApiError('Phoenix could not load session annotations', async () => {
    const client = await compatibleClient(
      instance,
      'Session annotations',
      sessionReviewCompatibility.sessionAnnotations
    );
    const annotations = new Map<string, SessionAnnotation>();

    for (let index = 0; index < ids.length; index += ANNOTATION_SESSION_BATCH_SIZE) {
      const batch = ids.slice(index, index + ANNOTATION_SESSION_BATCH_SIZE);
      const seenCursors = new Set<string>();
      let cursor: string | null = null;
      do {
        const response = await client.GET('/v1/projects/{project_identifier}/session_annotations', {
          params: {
            path: { project_identifier: projectId },
            query: {
              cursor,
              include_annotation_names: names,
              limit: API_PAGE_SIZE,
              session_ids: batch,
            },
          },
        });
        if (!response.data) throw new Error('The server returned an empty session annotation response.');
        for (const annotation of response.data.data) annotations.set(annotation.id, annotation);
        cursor = nextUnseenCursor(response.data.next_cursor, seenCursors);
      } while (cursor);
    }

    return [...annotations.values()];
  });
}

export function createSessionAnnotationBatches(
  sessionIdPages: readonly (readonly string[])[]
): string[][] {
  const seen = new Set<string>();
  return sessionIdPages.flatMap((page) => {
    const ids = page.flatMap((sessionId) => {
      const id = sessionId.trim();
      if (!id || seen.has(id)) return [];
      seen.add(id);
      return [id];
    });
    const batches: string[][] = [];
    for (let index = 0; index < ids.length; index += ANNOTATION_SESSION_BATCH_SIZE) {
      batches.push(ids.slice(index, index + ANNOTATION_SESSION_BATCH_SIZE));
    }
    return batches;
  });
}

export async function writeSessionAnnotation(
  instance: PhoenixInstance,
  input: SessionAnnotationWrite
): Promise<{ id: string }> {
  const annotation = buildSessionAnnotationData(input);
  return withSessionApiError('Phoenix could not save the session annotation', async () => {
    const client = await compatibleClient(
      instance,
      'Session annotations',
      sessionReviewCompatibility.sessionAnnotations
    );
    const response = await client.POST('/v1/session_annotations', {
      params: { query: { sync: true } },
      body: { data: [annotation] },
    });
    const inserted = response.data?.data?.[0];
    if (!inserted) throw new Error('The server did not return the saved annotation ID.');
    return inserted;
  });
}

export async function writeSessionAnnotations(
  instance: PhoenixInstance,
  input: SessionAnnotationsWrite
): Promise<{ id: string }[]> {
  if (input.annotations.length === 0) return [];
  const annotations = input.annotations.map(buildSessionAnnotationData);
  return withSessionApiError('Phoenix could not save the session review', async () => {
    const client = await compatibleClient(
      instance,
      'Session annotations',
      sessionReviewCompatibility.sessionAnnotations
    );
    const response = await client.POST('/v1/session_annotations', {
      params: { query: { sync: true } },
      body: { data: annotations },
    });
    const inserted = response.data?.data;
    if (!inserted || inserted.length !== annotations.length) {
      throw new Error('The server did not confirm every review value.');
    }
    return inserted;
  });
}

export async function writeSessionNote(
  instance: PhoenixInstance,
  input: SessionNoteWrite
): Promise<{ id: string }> {
  const sessionId = requiredText(input.sessionId, 'sessionId', 'Session ID is required.');
  const identifier = requiredText(input.identifier, 'identifier', 'Reviewer identity is required.');
  const note = requiredText(input.note, 'note', 'Note text is required.');
  return withSessionApiError('Phoenix could not save the session note', async () => {
    const client = await compatibleClient(
      instance,
      'Deterministic session notes',
      sessionReviewCompatibility.deterministicNoteIdentifiers
    );
    const response = await client.POST('/v1/session_notes', {
      body: {
        data: {
          session_id: sessionId,
          note,
          identifier,
        },
      },
    });
    if (!response.data?.data) throw new Error('The server did not return the saved note ID.');
    return response.data.data;
  });
}

export function buildSessionAnnotationData(input: SessionAnnotationWrite): SessionAnnotationData {
  const sessionId = requiredText(input.sessionId, 'sessionId', 'Session ID is required.');
  const identifier = requiredText(input.identifier, 'identifier', 'Reviewer identity is required.');
  if (input.config.name === 'note') {
    throw new SessionReviewValidationError([
      { field: 'config', message: 'The reserved note config cannot be used as a review annotation.' },
    ]);
  }
  if (input.config.type !== input.draft.type) {
    throw new SessionReviewValidationError([
      { field: 'config', message: 'The annotation value does not match its configuration type.' },
    ]);
  }

  const result = resultForDraft(input.config, input.draft);
  return {
    annotator_kind: 'HUMAN',
    identifier,
    metadata: { client: 'phoenix-mobile' },
    name: input.config.name,
    result,
    session_id: sessionId,
  };
}

export function createSessionReviewIdentifier(
  kind: 'annotation' | 'note',
  ownerKey: string
): string {
  return `phoenix-mobile:${kind}:${ownerKey.trim()}`;
}

export function createAuthenticatedAnnotationIdentifier(viewerId: string): string {
  return `px-app:${viewerId.trim()}`;
}

function resultForDraft(
  config: SessionAnnotationConfig,
  draft: SessionAnnotationDraft
): NonNullable<SessionAnnotationData['result']> {
  const explanation = draft.explanation?.trim() || undefined;
  if (config.type === 'CATEGORICAL' && draft.type === 'CATEGORICAL') {
    const value = config.values.find((candidate) => candidate.label === draft.label.trim());
    if (!value) {
      throw new SessionReviewValidationError([
        { field: 'label', message: 'Select a label defined by this annotation configuration.' },
      ]);
    }
    return { label: value.label, ...(value.score != null ? { score: value.score } : {}), ...(explanation ? { explanation } : {}) };
  }
  if (config.type === 'CONTINUOUS' && draft.type === 'CONTINUOUS') {
    if (!Number.isFinite(draft.score)) {
      throw new SessionReviewValidationError([
        { field: 'score', message: 'Enter a finite review score.' },
      ]);
    }
    if (config.lower_bound != null && draft.score < config.lower_bound) {
      throw new SessionReviewValidationError([
        { field: 'score', message: `Score must be at least ${config.lower_bound}.` },
      ]);
    }
    if (config.upper_bound != null && draft.score > config.upper_bound) {
      throw new SessionReviewValidationError([
        { field: 'score', message: `Score must be at most ${config.upper_bound}.` },
      ]);
    }
    return { score: draft.score, ...(explanation ? { explanation } : {}) };
  }
  if (config.type === 'FREEFORM' && draft.type === 'FREEFORM') {
    if (!explanation) {
      throw new SessionReviewValidationError([
        { field: 'explanation', message: 'Enter a non-empty freeform review.' },
      ]);
    }
    return { explanation };
  }
  throw new SessionReviewValidationError([
    { field: 'config', message: 'The annotation value does not match its configuration type.' },
  ]);
}

async function fetchRootSpanBatch(
  client: PhoenixClient,
  projectId: string,
  traceIds: string[]
): Promise<PhoenixSpan[]> {
  const spans = new Map<string, PhoenixSpan>();
  const seenCursors = new Set<string>();
  let cursor: string | null = null;
  do {
    const response = await client.GET('/v1/projects/{project_identifier}/spans', {
      params: {
        path: { project_identifier: projectId },
        query: {
          cursor,
          limit: ROOT_SPAN_BATCH_SIZE,
          parent_id: 'null',
          trace_id: traceIds,
        },
      },
    });
    if (!response.data) throw new Error('The server returned an empty root-span response.');
    for (const span of response.data.data) {
      const key = span.id ?? `${span.context.trace_id}:${span.context.span_id}`;
      spans.set(key, span);
    }
    cursor = nextUnseenCursor(response.data.next_cursor, seenCursors);
  } while (cursor);
  return [...spans.values()];
}

function extractIO(
  attributes: Record<string, unknown> | undefined,
  valueKey: string,
  mimeTypeKey: string
): SessionTurnIO | undefined {
  const value = attributes?.[valueKey];
  if (value == null) return undefined;
  const mimeType = attributes?.[mimeTypeKey];
  return { value: String(value), ...(mimeType != null ? { mimeType: String(mimeType) } : {}) };
}

function compareCanonicalRoots(left: PhoenixSpan, right: PhoenixSpan): number {
  return left.start_time.localeCompare(right.start_time) ||
    left.context.span_id.localeCompare(right.context.span_id);
}

export function nextUnseenCursor(nextCursor: string | null, seenCursors: Set<string>): string | null {
  if (!nextCursor || seenCursors.has(nextCursor)) return null;
  seenCursors.add(nextCursor);
  return nextCursor;
}

async function compatibleClient(
  instance: PhoenixInstance,
  capability: string,
  minimumVersion: readonly [number, number, number]
): Promise<PhoenixClient> {
  const client = await acquireSessionReviewClient(instance);
  const version = await getCachedServerVersion(instance, client);
  if (compareVersions(version, minimumVersion) < 0) {
    throw new SessionReviewCompatibilityError(capability, minimumVersion, version);
  }
  return client;
}

const serverVersionCache = new Map<string, Promise<readonly number[]>>();
const MAX_SERVER_VERSION_CACHE_ENTRIES = 24;

async function getCachedServerVersion(
  instance: PhoenixInstance,
  client: PhoenixClient
): Promise<readonly number[]> {
  const authKey = instance.auth.type === 'oauth2' ? instance.auth.credentialKey : 'anonymous';
  const key = `${instance.id}:${authKey}`;
  let version = serverVersionCache.get(key);
  if (!version) {
    version = client.getServerVersion();
    serverVersionCache.set(key, version);
    if (serverVersionCache.size > MAX_SERVER_VERSION_CACHE_ENTRIES) {
      serverVersionCache.delete(serverVersionCache.keys().next().value!);
    }
    void version.catch(() => serverVersionCache.delete(key));
  }
  return version;
}

export function compareVersions(left: readonly number[], right: readonly number[]): number {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function requiredText(
  value: string,
  field: SessionReviewValidationIssue['field'],
  message: string
): string {
  const trimmed = value.trim();
  if (!trimmed) throw new SessionReviewValidationError([{ field, message }]);
  return trimmed;
}

async function withSessionApiError<T>(operation: string, request: () => Promise<T>): Promise<T> {
  try {
    return await request();
  } catch (error) {
    if (error instanceof SessionReviewCompatibilityError || error instanceof SessionReviewValidationError) {
      throw error;
    }
    throw new SessionReviewApiError(operation, error);
  }
}

function formatUnknownError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'An unknown Phoenix API error occurred.';
}
