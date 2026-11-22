import { chmodSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { setTimeout } from "node:timers/promises";
import { drizzle } from "drizzle-orm/node-sqlite";
import { migrateEnvironmentState } from "#server/persistence/sqlite/migrations.ts";
import { storageSync } from "#server/persistence/sqlite/storage-operation.ts";
import type { EnvironmentPaths } from "#server/persistence/storage/environment-paths.ts";

const busyTimeoutMilliseconds = 1_000;
const databaseLockRetryMilliseconds = 10;
const databaseLockRetryCount = 10;
const openFailure = "Could not open Environment state";

export async function openEnvironmentDatabase(paths: EnvironmentPaths) {
  const database = storageSync(
    openFailure,
    () =>
      new DatabaseSync(paths.stateDatabase, {
        allowUnknownNamedParameters: false,
        enableForeignKeyConstraints: true,
        timeout: busyTimeoutMilliseconds,
      }),
  );
  try {
    await retryDatabaseLock(() => configureDatabase(database));
    await retryDatabaseLock(() =>
      migrateEnvironmentState(drizzle({ client: database })),
    );
    storageSync(openFailure, () =>
      restrictDatabasePermissions(paths.stateDatabase),
    );
    return database;
  } catch (error) {
    database.close();
    throw error;
  }
}

function configureDatabase(database: DatabaseSync) {
  database.exec(`
    PRAGMA busy_timeout = ${busyTimeoutMilliseconds};
    PRAGMA synchronous = NORMAL;
  `);
  enableWriteAheadLogging(database);
}

async function retryDatabaseLock(operation: () => void) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return storageSync(openFailure, operation);
    } catch (error) {
      if (attempt === databaseLockRetryCount || !isDatabaseLocked(error))
        throw error;
      await setTimeout(databaseLockRetryMilliseconds);
    }
  }
}

function isDatabaseLocked(error: unknown) {
  return error instanceof Error && error.message.includes("database is locked");
}

function enableWriteAheadLogging(database: DatabaseSync) {
  try {
    database.exec("PRAGMA journal_mode = WAL;");
  } catch (error) {
    if (readJournalMode(database) !== "wal") throw error;
  }
}

function readJournalMode(database: DatabaseSync) {
  const result = database.prepare("PRAGMA journal_mode").get() as {
    journal_mode: string;
  };
  return result.journal_mode;
}

function restrictDatabasePermissions(path: string) {
  if (process.platform !== "win32") {
    chmodSync(path, 0o600);
  }
}
