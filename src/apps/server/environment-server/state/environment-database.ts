import { chmodSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { migrateEnvironmentState } from "@rebase/server/environment-server/state/migrations";
import { storageSync } from "@rebase/server/environment-server/state/storage-operation";
import type { EnvironmentPaths } from "@rebase/server/environment-server/storage/environment-paths.contract";
import { Effect } from "effect";

export function openEnvironmentDatabase(paths: EnvironmentPaths) {
  return storageSync("Could not open Environment state", () => {
    const database = new DatabaseSync(paths.stateDatabase, {
      allowUnknownNamedParameters: false,
      enableForeignKeyConstraints: true,
      timeout: 250,
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
  const journalMode = database.prepare("PRAGMA journal_mode").get() as {
    journal_mode: string;
  };
  const busyTimeout = database.prepare("PRAGMA busy_timeout").get() as {
    timeout: number;
  };

  return {
    busyTimeout: busyTimeout.timeout,
    foreignKeys: foreignKeys.foreign_keys === 1,
    journalMode: journalMode.journal_mode,
  };
}

function configureDatabase(database: DatabaseSync) {
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA busy_timeout = 250;
  `);
}

function restrictDatabasePermissions(path: string) {
  if (process.platform !== "win32") {
    chmodSync(path, 0o600);
  }
}
