import type { EnvironmentStorageError } from "@rebase/server/environment-server/storage/storage-error.contract";
import type { NodeSQLiteDatabase } from "drizzle-orm/node-sqlite";
import type { Effect } from "effect";

export interface EnvironmentContext {
  readonly database: NodeSQLiteDatabase;
  readonly databaseSettings: {
    readonly busyTimeout: number;
    readonly foreignKeys: boolean;
    readonly journalMode: string;
  };
  readonly read: <Value>(
    message: string,
    operation: (database: NodeSQLiteDatabase) => PromiseLike<Value> | Value,
  ) => Effect.Effect<Value, EnvironmentStorageError>;
  readonly write: <Value>(
    message: string,
    operation: (database: NodeSQLiteDatabase) => PromiseLike<Value> | Value,
  ) => Effect.Effect<Value, EnvironmentStorageError>;
}
