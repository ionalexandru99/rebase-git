import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { eq } from "drizzle-orm";
import { drizzle, type NodeSQLiteDatabase } from "drizzle-orm/node-sqlite";
import { Effect, type Scope, Semaphore } from "effect";
import { environmentTable } from "#server/persistence/environment-state.schema.ts";
import {
  closeEnvironmentDatabase,
  openEnvironmentDatabase,
} from "#server/persistence/sqlite/database.ts";
import {
  type EnvironmentStorageError,
  serializedPromise,
  storagePromise,
  storageSync,
} from "#server/persistence/sqlite/storage-operation.ts";
import {
  type EnvironmentPaths,
  prepareEnvironmentDirectories,
} from "#server/persistence/storage/environment-paths.ts";
import { ensureServerSecret } from "#server/persistence/storage/server-secret.ts";

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

export function acquireEnvironmentContext(
  paths: EnvironmentPaths,
): Effect.Effect<EnvironmentContext, EnvironmentStorageError, Scope.Scope> {
  return Effect.gen(function* () {
    yield* prepareEnvironmentDirectories(paths);
    const serverSecret = yield* ensureServerSecret(paths);
    const database = yield* Effect.acquireRelease(
      openEnvironmentDatabase(paths),
      closeEnvironmentDatabase,
    );
    const context = yield* storageSync(
      "Could not read Environment state settings",
      () => createEnvironmentContext(database, serverSecret),
    );
    yield* initializeEnvironment(context);
    return context;
  });
}

function createEnvironmentContext(
  database: DatabaseSync,
  serverSecret: string,
): EnvironmentContext {
  const drizzleDatabase = drizzle({ client: database });
  const writer = Semaphore.makeUnsafe(1);

  return {
    database: drizzleDatabase,
    serverSecret,
    read: (message, operation) =>
      storagePromise(message, () => operation(drizzleDatabase)),
    write: (message, operation) =>
      serializedPromise(writer, message, () => operation(drizzleDatabase)),
  };
}

function initializeEnvironment(context: EnvironmentContext) {
  return context.write(
    "Could not initialize Environment state",
    async (database) => {
      await database
        .insert(environmentTable)
        .values({ id: randomUUID(), singleton: 1 })
        .onConflictDoNothing({ target: environmentTable.singleton });
      const environment = await database
        .select({ id: environmentTable.id })
        .from(environmentTable)
        .where(eq(environmentTable.singleton, 1))
        .get();
      if (environment === undefined) {
        throw new Error("The Environment identity is missing.");
      }
    },
  );
}
