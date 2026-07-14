import * as SQLite from 'expo-sqlite';

import type { ModelSelection, PxiMessage } from '@/features/pxi/types';

const DATABASE_NAME = 'phoenix-mobile.db';
const DATABASE_VERSION = 2;

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

type SessionRow = {
  id: string;
  instance_id: string;
  model_json: string;
  title: string;
  message_count: number;
  generation: number;
  revision: number;
  created_at: string;
  updated_at: string;
};

type MessageRow = { message_json: string };

export class PxiSessionConflictError extends Error {}
export class PxiSessionDeletedError extends Error {}

let databasePromise: Promise<SQLite.SQLiteDatabase> | null = null;
let operationQueue: Promise<void> = Promise.resolve();

function serializeOperation<Result>(operation: () => Promise<Result>): Promise<Result> {
  const result = operationQueue.then(operation, operation);
  operationQueue = result.then(() => undefined, () => undefined);
  return result;
}

async function openDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (!databasePromise) {
    const opening = SQLite.openDatabaseAsync(DATABASE_NAME).then(async (database) => {
      await database.execAsync('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
      const version = await database.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
      const currentVersion = version?.user_version ?? 0;
      if (currentVersion < DATABASE_VERSION) {
        await database.execAsync('BEGIN IMMEDIATE');
        try {
          if (currentVersion === 0) {
            await database.execAsync(`
          CREATE TABLE IF NOT EXISTS pxi_sessions (
            id TEXT PRIMARY KEY NOT NULL,
            instance_id TEXT NOT NULL,
            model_json TEXT NOT NULL,
            title TEXT NOT NULL,
            generation INTEGER NOT NULL,
            revision INTEGER NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
          );
          CREATE INDEX IF NOT EXISTS pxi_sessions_instance_updated
            ON pxi_sessions (instance_id, updated_at DESC);
          CREATE TABLE IF NOT EXISTS pxi_messages (
            session_id TEXT NOT NULL,
            position INTEGER NOT NULL,
            message_json TEXT NOT NULL,
            PRIMARY KEY (session_id, position),
            FOREIGN KEY (session_id) REFERENCES pxi_sessions(id) ON DELETE CASCADE
          );
          CREATE TABLE IF NOT EXISTS pxi_metadata (
            key TEXT PRIMARY KEY NOT NULL,
            value INTEGER NOT NULL
          );
          INSERT OR IGNORE INTO pxi_metadata (key, value) VALUES ('history_generation', 0);
          CREATE TABLE IF NOT EXISTS pxi_deleted_sessions (
            id TEXT PRIMARY KEY NOT NULL,
            deleted_at TEXT NOT NULL
          );
          CREATE TABLE IF NOT EXISTS pxi_deleted_instances (
            instance_id TEXT PRIMARY KEY NOT NULL,
            deleted_at TEXT NOT NULL
          );
        `);
          } else if (currentVersion === 1) {
            await database.execAsync(`
          ALTER TABLE pxi_sessions ADD COLUMN generation INTEGER NOT NULL DEFAULT 0;
          ALTER TABLE pxi_sessions ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;
          CREATE TABLE pxi_metadata (key TEXT PRIMARY KEY NOT NULL, value INTEGER NOT NULL);
          INSERT INTO pxi_metadata (key, value) VALUES ('history_generation', 0);
          CREATE TABLE pxi_deleted_sessions (id TEXT PRIMARY KEY NOT NULL, deleted_at TEXT NOT NULL);
          CREATE TABLE pxi_deleted_instances (instance_id TEXT PRIMARY KEY NOT NULL, deleted_at TEXT NOT NULL);
        `);
          }
          await database.execAsync(`PRAGMA user_version = ${DATABASE_VERSION}; COMMIT;`);
        } catch (error) {
          await database.execAsync('ROLLBACK').catch(() => undefined);
          await database.closeAsync().catch(() => undefined);
          throw error;
        }
      }
      return database;
    });
    databasePromise = opening;
    void opening.catch(() => {
      if (databasePromise === opening) databasePromise = null;
    });
  }
  return databasePromise;
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

function parseModel(value: string): ModelSelection {
  const model = JSON.parse(value) as ModelSelection;
  if (model.providerType !== 'builtin' && model.providerType !== 'custom') {
    throw new Error('Saved PXI session has an invalid model.');
  }
  return model;
}

function toSummary(row: SessionRow): PxiSessionSummary {
  return {
    id: row.id,
    instanceId: row.instance_id,
    model: parseModel(row.model_json),
    title: row.title,
    messageCount: row.message_count,
    generation: row.generation,
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listPxiSessions(instanceId: string): Promise<PxiSessionSummary[]> {
  return serializeOperation(async () => {
    const database = await openDatabase();
    const rows = await database.getAllAsync<SessionRow>(
      `SELECT sessions.*, COUNT(messages.position) AS message_count
       FROM pxi_sessions AS sessions
       LEFT JOIN pxi_messages AS messages ON messages.session_id = sessions.id
       WHERE sessions.instance_id = ?
       GROUP BY sessions.id
       ORDER BY sessions.updated_at DESC`,
      instanceId
    );
    return rows.map(toSummary);
  });
}

export function getPxiSession(sessionId: string): Promise<StoredPxiSession | null> {
  return serializeOperation(async () => {
    const database = await openDatabase();
    await database.execAsync('BEGIN');
    try {
      const row = await database.getFirstAsync<SessionRow>(
        `SELECT sessions.*, COUNT(messages.position) AS message_count
         FROM pxi_sessions AS sessions
         LEFT JOIN pxi_messages AS messages ON messages.session_id = sessions.id
         WHERE sessions.id = ?
         GROUP BY sessions.id`,
        sessionId
      );
      if (!row) {
        await database.execAsync('COMMIT');
        return null;
      }
      const messageRows = await database.getAllAsync<MessageRow>(
        'SELECT message_json FROM pxi_messages WHERE session_id = ? ORDER BY position ASC',
        sessionId
      );
      await database.execAsync('COMMIT');
      return {
        ...toSummary(row),
        messages: messageRows.map(({ message_json }) => JSON.parse(message_json) as PxiMessage),
      };
    } catch (error) {
      await database.execAsync('ROLLBACK').catch(() => undefined);
      throw error;
    }
  });
}

export function savePxiSession(input: SavePxiSessionInput): Promise<StoredPxiSession | null> {
  if (input.messages.length === 0) return Promise.resolve(null);
  return serializeOperation(async () => {
    const database = await openDatabase();
    const now = new Date().toISOString();
    const title = getSessionTitle(input.messages);

    await database.execAsync('BEGIN IMMEDIATE');
    try {
      const generation = await database.getFirstAsync<{ value: number }>(
        "SELECT value FROM pxi_metadata WHERE key = 'history_generation'"
      );
      const deletedSession = await database.getFirstAsync<{ found: number }>(
        'SELECT 1 AS found FROM pxi_deleted_sessions WHERE id = ?',
        input.id
      );
      const deletedInstance = await database.getFirstAsync<{ found: number }>(
        'SELECT 1 AS found FROM pxi_deleted_instances WHERE instance_id = ?',
        input.instanceId
      );
      const existing = await database.getFirstAsync<{ created_at: string; revision: number }>(
        'SELECT created_at, revision FROM pxi_sessions WHERE id = ?',
        input.id
      );
      if (deletedSession || deletedInstance || generation?.value !== input.generation) {
        throw new PxiSessionDeletedError('This PXI session was deleted and cannot be saved again.');
      }
      if ((existing?.revision ?? 0) !== input.revision) {
        throw new PxiSessionConflictError('This PXI session changed in another window.');
      }
      const createdAt = existing?.created_at ?? now;
      const revision = input.revision + 1;
      await database.runAsync(
        `INSERT INTO pxi_sessions (id, instance_id, model_json, title, generation, revision, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           instance_id = excluded.instance_id,
           model_json = excluded.model_json,
           title = excluded.title,
           generation = excluded.generation,
           revision = excluded.revision,
           updated_at = excluded.updated_at`,
        input.id,
        input.instanceId,
        JSON.stringify(input.model),
        title,
        input.generation,
        revision,
        createdAt,
        now
      );
      await database.runAsync('DELETE FROM pxi_messages WHERE session_id = ?', input.id);
      const statement = await database.prepareAsync(
        'INSERT INTO pxi_messages (session_id, position, message_json) VALUES (?, ?, ?)'
      );
      try {
        for (const [position, message] of input.messages.entries()) {
          await statement.executeAsync([input.id, position, JSON.stringify(message)]);
        }
      } finally {
        await statement.finalizeAsync();
      }
      await database.execAsync('COMMIT');
      return {
        id: input.id,
        instanceId: input.instanceId,
        model: input.model,
        messages: input.messages,
        title,
        messageCount: input.messages.length,
        generation: input.generation,
        revision,
        createdAt,
        updatedAt: now,
      };
    } catch (error) {
      await database.execAsync('ROLLBACK');
      throw error;
    }
  });
}

export function deletePxiSession(sessionId: string): Promise<void> {
  return serializeOperation(async () => {
    const database = await openDatabase();
    await database.execAsync('BEGIN IMMEDIATE');
    try {
      await database.runAsync(
        'INSERT OR REPLACE INTO pxi_deleted_sessions (id, deleted_at) VALUES (?, ?)',
        sessionId,
        new Date().toISOString()
      );
      await database.runAsync('DELETE FROM pxi_sessions WHERE id = ?', sessionId);
      await database.execAsync('COMMIT');
    } catch (error) {
      await database.execAsync('ROLLBACK');
      throw error;
    }
  });
}

export function deletePxiSessionsForInstance(instanceId: string): Promise<void> {
  return serializeOperation(async () => {
    const database = await openDatabase();
    await database.execAsync('BEGIN IMMEDIATE');
    try {
      await database.runAsync(
        'INSERT OR REPLACE INTO pxi_deleted_instances (instance_id, deleted_at) VALUES (?, ?)',
        instanceId,
        new Date().toISOString()
      );
      await database.runAsync('DELETE FROM pxi_sessions WHERE instance_id = ?', instanceId);
      await database.execAsync('COMMIT');
    } catch (error) {
      await database.execAsync('ROLLBACK');
      throw error;
    }
  });
}

export function clearPxiSessions(): Promise<void> {
  return serializeOperation(async () => {
    const database = await openDatabase();
    await database.execAsync('BEGIN IMMEDIATE');
    try {
      await database.runAsync(
        "UPDATE pxi_metadata SET value = value + 1 WHERE key = 'history_generation'"
      );
      await database.runAsync('DELETE FROM pxi_sessions');
      await database.runAsync('DELETE FROM pxi_deleted_sessions');
      await database.execAsync('COMMIT');
    } catch (error) {
      await database.execAsync('ROLLBACK');
      throw error;
    }
  });
}

export function getPxiHistoryGeneration(): Promise<number> {
  return serializeOperation(async () => {
    const database = await openDatabase();
    const row = await database.getFirstAsync<{ value: number }>(
      "SELECT value FROM pxi_metadata WHERE key = 'history_generation'"
    );
    return row?.value ?? 0;
  });
}

export function countPxiSessions(): Promise<number> {
  return serializeOperation(async () => {
    const database = await openDatabase();
    const row = await database.getFirstAsync<{ count: number }>('SELECT COUNT(*) AS count FROM pxi_sessions');
    return row?.count ?? 0;
  });
}
