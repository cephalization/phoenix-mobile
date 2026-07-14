import type { ModelSelection, PxiMessage } from '@/features/pxi/types';

const DATABASE_NAME = 'phoenix-mobile-pxi';
const DATABASE_VERSION = 1;
const HISTORY_GENERATION_KEY = 'history_generation';
const STORES = {
  deletedInstances: 'deleted_instances',
  deletedSessions: 'deleted_sessions',
  metadata: 'metadata',
  sessions: 'sessions',
} as const;

export type PxiSessionSummary = {
  id: string;
  instanceId: string;
  model: ModelSelection;
  title: string;
  messageCount: number;
  generation: number;
  revision: number;
  createdAt: string;
  updatedAt: string;
};

export type StoredPxiSession = PxiSessionSummary & {
  messages: PxiMessage[];
};

export type SavePxiSessionInput = Pick<
  StoredPxiSession,
  'generation' | 'id' | 'instanceId' | 'messages' | 'model' | 'revision'
>;

type MetadataRecord = { key: string; value: number };
type DeletedSessionRecord = { id: string; deletedAt: string };
type DeletedInstanceRecord = { instanceId: string; deletedAt: string };

export class PxiSessionConflictError extends Error {}
export class PxiSessionDeletedError extends Error {}

let databasePromise: Promise<IDBDatabase> | null = null;
let operationQueue: Promise<void> = Promise.resolve();

function serializeOperation<Result>(operation: () => Promise<Result>): Promise<Result> {
  const result = operationQueue.then(operation, operation);
  operationQueue = result.then(() => undefined, () => undefined);
  return result;
}

function openDatabase(): Promise<IDBDatabase> {
  if (databasePromise) return databasePromise;
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('IndexedDB is unavailable in this browser.'));
  }

  const opening = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onerror = () => reject(request.error ?? new Error('Could not open browser storage.'));
    request.onblocked = () => reject(new Error('Browser storage is blocked by another Phoenix Mobile tab.'));
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORES.sessions)) {
        database.createObjectStore(STORES.sessions, { keyPath: 'id' });
      }
      if (!database.objectStoreNames.contains(STORES.deletedSessions)) {
        database.createObjectStore(STORES.deletedSessions, { keyPath: 'id' });
      }
      if (!database.objectStoreNames.contains(STORES.deletedInstances)) {
        database.createObjectStore(STORES.deletedInstances, { keyPath: 'instanceId' });
      }
      if (!database.objectStoreNames.contains(STORES.metadata)) {
        const metadata = database.createObjectStore(STORES.metadata, { keyPath: 'key' });
        metadata.put({ key: HISTORY_GENERATION_KEY, value: 0 } satisfies MetadataRecord);
      }
    };
    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => database.close();
      resolve(database);
    };
  });

  databasePromise = opening;
  void opening.catch(() => {
    if (databasePromise === opening) databasePromise = null;
  });
  return opening;
}

function requestResult<Result>(request: IDBRequest<Result>): Promise<Result> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Browser storage request failed.'));
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error('Browser storage transaction was aborted.'));
    transaction.onerror = () => reject(transaction.error ?? new Error('Browser storage transaction failed.'));
  });
}

async function runTransaction<Result>(
  storeNames: string | string[],
  mode: IDBTransactionMode,
  operation: (transaction: IDBTransaction) => Promise<Result>
): Promise<Result> {
  const database = await openDatabase();
  const transaction = database.transaction(storeNames, mode);
  const completion = transactionComplete(transaction);
  try {
    const result = await operation(transaction);
    await completion;
    return result;
  } catch (error) {
    try {
      transaction.abort();
    } catch {
      // The browser may have already aborted or completed the transaction.
    }
    await completion.catch(() => undefined);
    throw error;
  }
}

function getSessionTitle(messages: PxiMessage[]): string {
  const firstUserMessage = messages.find((message) => message.role === 'user');
  const text = firstUserMessage?.parts
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return 'Untitled chat';
  return text.length > 72 ? `${text.slice(0, 71).trimEnd()}…` : text;
}

function toSummary(session: StoredPxiSession): PxiSessionSummary {
  const { messages: _messages, ...summary } = session;
  return summary;
}

export function listPxiSessions(instanceId: string): Promise<PxiSessionSummary[]> {
  return serializeOperation(() =>
    runTransaction(STORES.sessions, 'readonly', async (transaction) => {
      const sessions = await requestResult<StoredPxiSession[]>(
        transaction.objectStore(STORES.sessions).getAll()
      );
      return sessions
        .filter((session) => session.instanceId === instanceId)
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .map(toSummary);
    })
  );
}

export function getPxiSession(sessionId: string): Promise<StoredPxiSession | null> {
  return serializeOperation(() =>
    runTransaction(STORES.sessions, 'readonly', async (transaction) => {
      const session = await requestResult<StoredPxiSession | undefined>(
        transaction.objectStore(STORES.sessions).get(sessionId)
      );
      return session ?? null;
    })
  );
}

export function savePxiSession(input: SavePxiSessionInput): Promise<StoredPxiSession | null> {
  if (input.messages.length === 0) return Promise.resolve(null);
  return serializeOperation(() =>
    runTransaction(Object.values(STORES), 'readwrite', async (transaction) => {
      const metadata = transaction.objectStore(STORES.metadata);
      const deletedSessions = transaction.objectStore(STORES.deletedSessions);
      const deletedInstances = transaction.objectStore(STORES.deletedInstances);
      const sessions = transaction.objectStore(STORES.sessions);
      const [generation, deletedSession, deletedInstance, existing] = await Promise.all([
        requestResult<MetadataRecord | undefined>(metadata.get(HISTORY_GENERATION_KEY)),
        requestResult<DeletedSessionRecord | undefined>(deletedSessions.get(input.id)),
        requestResult<DeletedInstanceRecord | undefined>(deletedInstances.get(input.instanceId)),
        requestResult<StoredPxiSession | undefined>(sessions.get(input.id)),
      ]);

      if (deletedSession || deletedInstance || generation?.value !== input.generation) {
        throw new PxiSessionDeletedError('This PXI session was deleted and cannot be saved again.');
      }
      if ((existing?.revision ?? 0) !== input.revision) {
        throw new PxiSessionConflictError('This PXI session changed in another window.');
      }

      const now = new Date().toISOString();
      const stored: StoredPxiSession = {
        id: input.id,
        instanceId: input.instanceId,
        model: input.model,
        messages: input.messages,
        title: getSessionTitle(input.messages),
        messageCount: input.messages.length,
        generation: input.generation,
        revision: input.revision + 1,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      await requestResult(sessions.put(stored));
      return stored;
    })
  );
}

export function deletePxiSession(sessionId: string): Promise<void> {
  return serializeOperation(() =>
    runTransaction([STORES.sessions, STORES.deletedSessions], 'readwrite', async (transaction) => {
      await Promise.all([
        requestResult(transaction.objectStore(STORES.deletedSessions).put({
          id: sessionId,
          deletedAt: new Date().toISOString(),
        } satisfies DeletedSessionRecord)),
        requestResult(transaction.objectStore(STORES.sessions).delete(sessionId)),
      ]);
    })
  );
}

export function deletePxiSessionsForInstance(instanceId: string): Promise<void> {
  return serializeOperation(() =>
    runTransaction([STORES.sessions, STORES.deletedInstances], 'readwrite', async (transaction) => {
      const sessions = transaction.objectStore(STORES.sessions);
      const existing = await requestResult<StoredPxiSession[]>(sessions.getAll());
      const deletions = existing
        .filter((session) => session.instanceId === instanceId)
        .map((session) => requestResult(sessions.delete(session.id)));
      await Promise.all([
        ...deletions,
        requestResult(transaction.objectStore(STORES.deletedInstances).put({
          instanceId,
          deletedAt: new Date().toISOString(),
        } satisfies DeletedInstanceRecord)),
      ]);
    })
  );
}

export function clearPxiSessions(): Promise<void> {
  return serializeOperation(() =>
    runTransaction([STORES.sessions, STORES.deletedSessions, STORES.metadata], 'readwrite', async (transaction) => {
      const metadata = transaction.objectStore(STORES.metadata);
      const generation = await requestResult<MetadataRecord | undefined>(metadata.get(HISTORY_GENERATION_KEY));
      await Promise.all([
        requestResult(metadata.put({
          key: HISTORY_GENERATION_KEY,
          value: (generation?.value ?? 0) + 1,
        } satisfies MetadataRecord)),
        requestResult(transaction.objectStore(STORES.sessions).clear()),
        requestResult(transaction.objectStore(STORES.deletedSessions).clear()),
      ]);
    })
  );
}

export function getPxiHistoryGeneration(): Promise<number> {
  return serializeOperation(() =>
    runTransaction(STORES.metadata, 'readonly', async (transaction) => {
      const metadata = await requestResult<MetadataRecord | undefined>(
        transaction.objectStore(STORES.metadata).get(HISTORY_GENERATION_KEY)
      );
      return metadata?.value ?? 0;
    })
  );
}

export function countPxiSessions(): Promise<number> {
  return serializeOperation(() =>
    runTransaction(STORES.sessions, 'readonly', (transaction) =>
      requestResult(transaction.objectStore(STORES.sessions).count())
    )
  );
}
