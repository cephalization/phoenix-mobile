import type { OutboxOperation } from './outbox-model';

import { unreachable } from '@/lib/unreachable';

/** The tail of a session ID, which is how people recognise one in a list. */
export function shortSessionId(sessionId: string): string {
  return sessionId.length > 8 ? `…${sessionId.slice(-8)}` : sessionId;
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/** A one-line description of a queued change, as a row title. */
export function describeOperation(operation: OutboxOperation): string {
  switch (operation.kind) {
    case 'sessionAnnotations': {
      const { annotations } = operation.payload;
      const sessionIds = [...new Set(annotations.map((annotation) => annotation.session_id))];

      const subject =
        sessionIds.length === 1
          ? `session ${shortSessionId(sessionIds[0])}`
          : plural(sessionIds.length, 'session');

      return `Review for ${subject} · ${plural(annotations.length, 'annotation')}`;
    }

    case 'sessionAnnotation': {
      const { annotation } = operation.payload;

      return `${annotation.name} on session ${shortSessionId(annotation.session_id)}`;
    }

    case 'sessionNote':
      return `Note on session ${shortSessionId(operation.payload.sessionId)}`;

    case 'addSessionToDataset': {
      const { body, sessionId } = operation.payload;

      return `Add session ${shortSessionId(sessionId)} to ${body.name}${
        body.action === 'create' ? ' (new)' : ''
      }`;
    }

    case 'createAnnotationConfig':
      return `Annotation config “${operation.payload.name.trim()}”`;

    default:
      return unreachable(operation);
  }
}

/** The second line: where the change stands, or why it failed. */
export function describeStatus(operation: OutboxOperation): string {
  if (operation.status === 'sending') return 'Uploading…';

  if (operation.status === 'failed') return operation.lastError ?? 'Phoenix rejected this change.';

  if (operation.lastError) {
    return `Will retry · ${operation.lastError}`;
  }

  return 'Waiting to upload';
}
