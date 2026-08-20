import { randomUUID } from "node:crypto";
import { chmodSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { errorMessage } from "@rebase/server/environment-server/error-inspection";
import type {
  AuthorizationMetadata,
  EnvironmentState,
  OperationActivity,
} from "@rebase/server/environment-server/state/environment-state.contract";
import { migrateEnvironmentState } from "@rebase/server/environment-server/state/migrations";
import {
  authorizationMetadataTable,
  environmentTable,
  operationActivityTable,
} from "@rebase/server/environment-server/state/schema";
import {
  defaultEnvironmentPaths,
  prepareEnvironmentDirectories,
} from "@rebase/server/environment-server/storage/environment-paths";
import type { EnvironmentPaths } from "@rebase/server/environment-server/storage/environment-paths.contract";
import { ensureServerSecret } from "@rebase/server/environment-server/storage/server-secret";
import { EnvironmentStorageError } from "@rebase/server/environment-server/storage/storage-error";
import { and, desc, eq, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-sqlite";
import { Effect, type Scope, Semaphore } from "effect";

export const operationActivityLimit = 200;

export function acquireEnvironmentState(
  paths: EnvironmentPaths = defaultEnvironmentPaths(),
): Effect.Effect<EnvironmentState, EnvironmentStorageError, Scope.Scope> {
  return Effect.gen(function* () {
    yield* prepareEnvironmentDirectories(paths);
    yield* ensureServerSecret(paths);
    const database = yield* Effect.acquireRelease(
      openDatabase(paths),
      closeDatabase,
    );
    const writer = Semaphore.makeUnsafe(1);
    const drizzleDatabase = drizzle({ client: database });

    const environment = yield* writer.withPermit(
      storagePromise("Could not initialize Environment state", async () => {
        await drizzleDatabase
          .insert(environmentTable)
          .values({ id: randomUUID(), singleton: 1 })
          .onConflictDoNothing({ target: environmentTable.singleton });
        const value = await drizzleDatabase
          .select()
          .from(environmentTable)
          .where(eq(environmentTable.singleton, 1))
          .get();
        if (value === undefined) {
          throw new Error("The Environment identity is missing.");
        }
        return value;
      }),
    );
    let automaticPort = environment.automaticPort;

    const selectAutomaticPort = (port: number) =>
      writer.withPermit(
        storagePromise("Could not save the automatic port", async () => {
          await drizzleDatabase
            .update(environmentTable)
            .set({ automaticPort: port })
            .where(
              and(
                eq(environmentTable.singleton, 1),
                isNull(environmentTable.automaticPort),
              ),
            );
          const selected = await drizzleDatabase
            .select({ automaticPort: environmentTable.automaticPort })
            .from(environmentTable)
            .where(eq(environmentTable.singleton, 1))
            .get();
          if (selected?.automaticPort === null || selected === undefined) {
            throw new Error("The automatic port was not saved.");
          }
          if (selected.automaticPort !== port) {
            throw new Error(
              `Another server selected automatic port ${selected.automaticPort}.`,
            );
          }
          automaticPort = selected.automaticPort;
        }),
      );

    const saveAuthorization = (authorization: AuthorizationMetadata) =>
      writer.withPermit(
        storagePromise("Could not save authorization metadata", async () => {
          await drizzleDatabase
            .insert(authorizationMetadataTable)
            .values(authorization)
            .onConflictDoUpdate({
              set: authorization,
              target: authorizationMetadataTable.id,
            });
        }),
      );

    const recordOperationActivity = (activity: OperationActivity) =>
      writer.withPermit(
        storageSync("Could not save operation activity", () => {
          database.exec("BEGIN IMMEDIATE");
          try {
            database
              .prepare(
                `
                  INSERT INTO operation_activity (id, kind, status, started_at, finished_at)
                  VALUES (?, ?, ?, ?, ?)
                  ON CONFLICT (id) DO UPDATE SET
                    kind = excluded.kind,
                    status = excluded.status,
                    started_at = excluded.started_at,
                    finished_at = excluded.finished_at
                `,
              )
              .run(
                activity.id,
                activity.kind,
                activity.status,
                activity.startedAt,
                activity.finishedAt,
              );
            database
              .prepare(
                `
                  DELETE FROM operation_activity
                  WHERE id NOT IN (
                    SELECT id
                    FROM operation_activity
                    ORDER BY started_at DESC, id DESC
                    LIMIT ?
                  )
                `,
              )
              .run(operationActivityLimit);
            database.exec("COMMIT");
          } catch (error) {
            if (database.isTransaction) {
              database.exec("ROLLBACK");
            }
            throw error;
          }
        }),
      );

    return {
      get automaticPort() {
        return automaticPort;
      },
      databaseSettings: readDatabaseSettings(database),
      environmentId: environment.id,
      listAuthorizations: storagePromise(
        "Could not read authorization metadata",
        () =>
          drizzleDatabase
            .select()
            .from(authorizationMetadataTable)
            .orderBy(authorizationMetadataTable.createdAt),
      ),
      listOperationActivity: storagePromise(
        "Could not read operation activity",
        () =>
          drizzleDatabase
            .select()
            .from(operationActivityTable)
            .orderBy(
              desc(operationActivityTable.startedAt),
              desc(operationActivityTable.id),
            ),
      ),
      recordOperationActivity,
      saveAuthorization,
      selectAutomaticPort,
    };
  });
}

function readDatabaseSettings(database: DatabaseSync) {
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

function openDatabase(paths: EnvironmentPaths) {
  return storageSync("Could not open Environment state", () => {
    const database = new DatabaseSync(paths.stateDatabase, {
      allowUnknownNamedParameters: false,
      enableForeignKeyConstraints: true,
      timeout: 250,
    });
    try {
      database.exec(`
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = NORMAL;
        PRAGMA busy_timeout = 250;
      `);
      migrateEnvironmentState(database);
      if (process.platform !== "win32") {
        chmodSync(paths.stateDatabase, 0o600);
      }
      return database;
    } catch (error) {
      database.close();
      throw error;
    }
  });
}

function closeDatabase(database: DatabaseSync) {
  return Effect.sync(() => database.close()).pipe(Effect.orDie);
}

function storagePromise<A>(message: string, operation: () => PromiseLike<A>) {
  return Effect.tryPromise({
    try: async () => operation(),
    catch: (cause) => storageError(message, cause),
  });
}

function storageSync<A>(message: string, operation: () => A) {
  return Effect.try({
    try: operation,
    catch: (cause) => storageError(message, cause),
  });
}

function storageError(message: string, cause: unknown) {
  return new EnvironmentStorageError({
    cause,
    message: `${message}: ${errorMessage(cause)}`,
  });
}
