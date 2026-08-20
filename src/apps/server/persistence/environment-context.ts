import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { EnvironmentContext } from "@rebase/server/persistence/environment-context.contract";
import { environmentTable } from "@rebase/server/persistence/environment-state.schema";
import {
  closeEnvironmentDatabase,
  openEnvironmentDatabase,
  readDatabaseSettings,
} from "@rebase/server/persistence/sqlite/database";
import {
  serializedPromise,
  storagePromise,
} from "@rebase/server/persistence/sqlite/storage-operation";
import {
  defaultEnvironmentPaths,
  prepareEnvironmentDirectories,
} from "@rebase/server/persistence/storage/environment-paths";
import type { EnvironmentPaths } from "@rebase/server/persistence/storage/environment-paths.contract";
import { ensureServerSecret } from "@rebase/server/persistence/storage/server-secret";
import type { EnvironmentStorageError } from "@rebase/server/persistence/storage/storage-error.contract";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-sqlite";
import { Effect, type Scope, Semaphore } from "effect";

export function acquireEnvironmentContext(
  paths: EnvironmentPaths = defaultEnvironmentPaths(),
): Effect.Effect<EnvironmentContext, EnvironmentStorageError, Scope.Scope> {
  return Effect.gen(function* () {
    yield* prepareEnvironmentDirectories(paths);
    yield* ensureServerSecret(paths);
    const database = yield* Effect.acquireRelease(
      openEnvironmentDatabase(paths),
      closeEnvironmentDatabase,
    );
    const context = createEnvironmentContext(database);
    yield* initializeEnvironment(context);
    return context;
  });
}

function createEnvironmentContext(database: DatabaseSync): EnvironmentContext {
  const drizzleDatabase = drizzle({ client: database });
  const writer = Semaphore.makeUnsafe(1);

  return {
    database: drizzleDatabase,
    databaseSettings: readDatabaseSettings(database),
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
