import { chmodSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { migrateEnvironmentState } from "@rebase/server/persistence/sqlite/migrations";
import { storageSync } from "@rebase/server/persistence/sqlite/storage-operation";
import type { EnvironmentPaths } from "@rebase/server/persistence/storage/environment-paths.contract";
import { Effect } from "effect";

const busyTimeoutMilliseconds = 1_000;

export function openEnvironmentDatabase(paths: EnvironmentPaths) {
  return storageSync("Could not open Environment state", () => {
    const database = new DatabaseSync(paths.stateDatabase, {
      allowUnknownNamedParameters: false,
      enableForeignKeyConstraints: true,
      timeout: busyTimeoutMilliseconds,
    });
    try {
      configureDatabase(database);
      migrateEnvironmentState(database);
      restrictDatabasePermissions(paths.stateDatabase);
      return database;
    } catch (error) {
      database.close();
      throw error;
    }
  });
}

export function closeEnvironmentDatabase(database: DatabaseSync) {
  return Effect.sync(() => database.close()).pipe(Effect.orDie);
}

export function readDatabaseSettings(database: DatabaseSync) {
  const foreignKeys = database.prepare("PRAGMA foreign_keys").get() as {
    foreign_keys: number;
  };
  const busyTimeout = database.prepare("PRAGMA busy_timeout").get() as {
    timeout: number;
  };

  return {
    busyTimeout: busyTimeout.timeout,
    foreignKeys: foreignKeys.foreign_keys === 1,
    journalMode: readJournalMode(database),
  };
}

function configureDatabase(database: DatabaseSync) {
  database.exec(`
    PRAGMA busy_timeout = ${busyTimeoutMilliseconds};
    PRAGMA synchronous = NORMAL;
  `);
  enableWriteAheadLogging(database);
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
