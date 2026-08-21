import type { NodeSQLiteDatabase } from "drizzle-orm/node-sqlite";
import type { Effect } from "effect";
import type { EnvironmentStorageError } from "#server/persistence/storage/storage-error.contract";

export interface EnvironmentContext {
  readonly database: NodeSQLiteDatabase;
  readonly databaseSettings: {
    readonly busyTimeout: number;
    readonly foreignKeys: boolean;
    readonly journalMode: string;
  };
  readonly serverSecret: string;
  readonly read: <Value>(
    message: string,
    operation: (database: NodeSQLiteDatabase) => PromiseLike<Value> | Value,
  ) => Effect.Effect<Value, EnvironmentStorageError>;
  readonly write: <Value>(
    message: string,
    operation: (database: NodeSQLiteDatabase) => PromiseLike<Value> | Value,
  ) => Effect.Effect<Value, EnvironmentStorageError>;
}
