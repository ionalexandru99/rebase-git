import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { eq } from "drizzle-orm";
import { drizzle, type NodeSQLiteDatabase } from "drizzle-orm/node-sqlite";
import { environmentTable } from "#server/persistence/environment-state.schema.ts";
import { openEnvironmentDatabase } from "#server/persistence/sqlite/database.ts";
import {
  storageOperation,
  storageSync,
} from "#server/persistence/sqlite/storage-operation.ts";
import {
  type EnvironmentPaths,
  prepareEnvironmentDirectories,
} from "#server/persistence/storage/environment-paths.ts";
import { ensureServerSecret } from "#server/persistence/storage/server-secret.ts";

type StorageAccess = <Value>(
  message: string,
  operation: (database: NodeSQLiteDatabase) => PromiseLike<Value> | Value,
) => Promise<Value>;

export interface EnvironmentContext {
  readonly database: NodeSQLiteDatabase;
  readonly serverSecret: string;
  readonly read: StorageAccess;
  readonly write: StorageAccess;
  readonly close: () => void;
}

export async function acquireEnvironmentContext(
  paths: EnvironmentPaths,
): Promise<EnvironmentContext> {
  await prepareEnvironmentDirectories(paths);
  const serverSecret = await ensureServerSecret(paths);
  const database = await openEnvironmentDatabase(paths);
  try {
    const context = storageSync(
      "Could not read Environment state settings",
      () => createEnvironmentContext(database, serverSecret),
    );
    await initializeEnvironment(context);
    return context;
  } catch (error) {
    database.close();
    throw error;
  }
}

function createEnvironmentContext(
  database: DatabaseSync,
  serverSecret: string,
): EnvironmentContext {
  const drizzleDatabase = drizzle({ client: database });
  let writes: Promise<unknown> = Promise.resolve();

  return {
    database: drizzleDatabase,
    serverSecret,
    read: (message, operation) =>
      storageOperation(message, () => operation(drizzleDatabase)),
    write: (message, operation) => {
      const written = writes.then(() =>
        storageOperation(message, () => operation(drizzleDatabase)),
      );
      writes = written.catch(() => undefined);
      return written;
    },
    close: () => database.close(),
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
