import type { NodeSQLiteDatabase } from "drizzle-orm/node-sqlite";
import { Context, type Effect } from "effect";
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

export class EnvironmentStorage extends Context.Service<
  EnvironmentStorage,
  EnvironmentContext
>()("EnvironmentStorage") {}
