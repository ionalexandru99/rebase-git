import type { DatabaseSync } from "node:sqlite";
import type { EnvironmentState } from "@rebase/server/environment-server/state/environment-state.contract";
import {
  listAuthorizationMetadata,
  saveAuthorizationMetadata,
} from "@rebase/server/environment-server/state/sqlite/authorization";
import {
  closeEnvironmentDatabase,
  openEnvironmentDatabase,
  readDatabaseSettings,
} from "@rebase/server/environment-server/state/sqlite/database";
import {
  initializeEnvironmentRecord,
  selectAutomaticPort,
} from "@rebase/server/environment-server/state/sqlite/environment";
import {
  listOperationActivity,
  saveOperationActivity,
} from "@rebase/server/environment-server/state/sqlite/operation-activity";
import {
  serializedPromise,
  serializedSync,
  storagePromise,
} from "@rebase/server/environment-server/state/sqlite/storage-operation";
import {
  defaultEnvironmentPaths,
  prepareEnvironmentDirectories,
} from "@rebase/server/environment-server/storage/environment-paths";
import type { EnvironmentPaths } from "@rebase/server/environment-server/storage/environment-paths.contract";
import { ensureServerSecret } from "@rebase/server/environment-server/storage/server-secret";
import type { EnvironmentStorageError } from "@rebase/server/environment-server/storage/storage-error";
import { drizzle } from "drizzle-orm/node-sqlite";
import { Effect, type Scope, Semaphore } from "effect";

export { operationActivityLimit } from "@rebase/server/environment-server/state/sqlite/operation-activity";

export function acquireEnvironmentState(
  paths: EnvironmentPaths = defaultEnvironmentPaths(),
): Effect.Effect<EnvironmentState, EnvironmentStorageError, Scope.Scope> {
  return Effect.gen(function* () {
    yield* prepareEnvironmentDirectories(paths);
    yield* ensureServerSecret(paths);
    const database = yield* Effect.acquireRelease(
      openEnvironmentDatabase(paths),
      closeEnvironmentDatabase,
    );
    return yield* createEnvironmentState(database);
  });
}

function createEnvironmentState(
  database: DatabaseSync,
): Effect.Effect<EnvironmentState, EnvironmentStorageError> {
  return Effect.gen(function* () {
    const drizzleDatabase = drizzle({ client: database });
    const writer = Semaphore.makeUnsafe(1);
    const environment = yield* serializedPromise(
      writer,
      "Could not initialize Environment state",
      () => initializeEnvironmentRecord(drizzleDatabase),
    );
    let automaticPort = environment.automaticPort;

    return {
      get automaticPort() {
        return automaticPort;
      },
      databaseSettings: readDatabaseSettings(database),
      environmentId: environment.id,
      listAuthorizations: storagePromise(
        "Could not read authorization metadata",
        () => listAuthorizationMetadata(drizzleDatabase),
      ),
      listOperationActivity: storagePromise(
        "Could not read operation activity",
        () => listOperationActivity(drizzleDatabase),
      ),
      recordOperationActivity: (activity) =>
        serializedSync(writer, "Could not save operation activity", () =>
          saveOperationActivity(database, activity),
        ),
      saveAuthorization: (authorization) =>
        serializedPromise(writer, "Could not save authorization metadata", () =>
          saveAuthorizationMetadata(drizzleDatabase, authorization),
        ),
      selectAutomaticPort: (port) =>
        serializedPromise(
          writer,
          "Could not save the automatic port",
          async () => {
            automaticPort = await selectAutomaticPort(drizzleDatabase, port);
          },
        ),
    };
  });
}
