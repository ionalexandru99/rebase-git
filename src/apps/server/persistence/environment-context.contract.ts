import type { NodeSQLiteDatabase } from "drizzle-orm/node-sqlite";
import type { Effect } from "effect";
import type { EnvironmentStorageError } from "#server/domain/environment-storage-error.contract";

export interface EnvironmentContext {
  readonly database: NodeSQLiteDatabase;
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
