import { chmodSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { drizzle } from "drizzle-orm/node-sqlite";
import { Effect, Schedule } from "effect";
import type { EnvironmentStorageError } from "#server/domain/environment-storage-error.contract";
import { migrateEnvironmentState } from "#server/persistence/sqlite/migrations";
import { storageSync } from "#server/persistence/sqlite/storage-operation";
import type { EnvironmentPaths } from "#server/persistence/storage/environment-paths.contract";

const busyTimeoutMilliseconds = 1_000;
const databaseLockRetryDelay = "10 millis";
const databaseLockRetryCount = 10;

export function openEnvironmentDatabase(paths: EnvironmentPaths) {
  return Effect.gen(function* () {
    const database = yield* storageSync(
      "Could not open Environment state",
      () =>
        new DatabaseSync(paths.stateDatabase, {
          allowUnknownNamedParameters: false,
          enableForeignKeyConstraints: true,
          timeout: busyTimeoutMilliseconds,
        }),
    );

    return yield* Effect.gen(function* () {
      yield* storageSync("Could not open Environment state", () =>
        configureDatabase(database),
      ).pipe(retryDatabaseLock);
      yield* migrateDatabase(database);
      yield* storageSync("Could not open Environment state", () =>
        restrictDatabasePermissions(paths.stateDatabase),
      );
      return database;
    }).pipe(Effect.onError(() => closeEnvironmentDatabase(database)));
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

function migrateDatabase(database: DatabaseSync) {
  return storageSync("Could not open Environment state", () =>
    migrateEnvironmentState(drizzle({ client: database })),
  ).pipe(retryDatabaseLock);
}

function retryDatabaseLock<Value>(
  effect: Effect.Effect<Value, EnvironmentStorageError>,
) {
  return effect.pipe(
    Effect.retry({
      schedule: Schedule.spaced(databaseLockRetryDelay),
      times: databaseLockRetryCount,
      while: isDatabaseLocked,
    }),
  );
}

function isDatabaseLocked(error: EnvironmentStorageError) {
  return error.message.includes("database is locked");
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
