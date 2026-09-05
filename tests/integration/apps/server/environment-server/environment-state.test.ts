import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { operationActivityLimit } from "@rebase/server/domain/environment-state.contract";
import {
  hasNoAutomaticPort,
  hasOperationStatus,
  isActiveAuthorization,
  isCurrentEnvironment,
} from "@rebase/server/features/environment-server/environment-state.specifications";
import { acquireEnvironmentContext } from "@rebase/server/persistence/environment-context";
import type { EnvironmentContext } from "@rebase/server/persistence/environment-context.contract";
import {
  authorizationMetadataTable,
  environmentTable,
  operationActivityTable,
} from "@rebase/server/persistence/environment-state.schema";
import { environmentPaths } from "@rebase/server/persistence/storage/environment-paths";
import { and, desc, notInArray } from "drizzle-orm";
import { type MigrationMeta, readMigrationFiles } from "drizzle-orm/migrator";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

const directories = new Set<string>();
const generatedMigrations = readMigrationFiles({
  migrationsFolder: resolve("src/apps/server/persistence/migrations"),
});
const createEnvironmentMigration = generatedMigrations[0];
const createActivityMigration = generatedMigrations[1];
const createAuthorizationCapabilitiesMigration = generatedMigrations[2];
const createRepositoryCatalogMigration = generatedMigrations[3];
const addLogicalRepositoryIdentityMigration = generatedMigrations[4];

if (
  createEnvironmentMigration === undefined ||
  createActivityMigration === undefined ||
  createAuthorizationCapabilitiesMigration === undefined ||
  createRepositoryCatalogMigration === undefined ||
  addLogicalRepositoryIdentityMigration === undefined
) {
  throw new Error("Expected five generated Environment state migrations.");
}

afterEach(async () => {
  await Promise.all(
    [...directories].map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
  directories.clear();
});

describe("Environment state", () => {
  it("creates restricted, separated storage and keeps identity and secrets stable", async () => {
    const paths = await createTemporaryPaths();

    const first = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const context = yield* acquireEnvironmentContext(paths);
          const environment = yield* readCurrentEnvironment(context);
          return {
            automaticPort: environment.automaticPort,
            databaseSettings: context.databaseSettings,
            environmentId: environment.id,
          };
        }),
      ),
    );
    const firstSecret = await readFile(paths.serverSecret, "utf8");

    const second = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const context = yield* acquireEnvironmentContext(paths);
          const environment = yield* readCurrentEnvironment(context);
          return {
            automaticPort: environment.automaticPort,
            databaseSettings: context.databaseSettings,
            environmentId: environment.id,
          };
        }),
      ),
    );

    expect(first.environmentId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(second).toEqual(first);
    expect(first.databaseSettings).toEqual({
      busyTimeout: 1_000,
      foreignKeys: true,
      journalMode: "wal",
    });
    expect(await readFile(paths.serverSecret, "utf8")).toBe(firstSecret);

    const databaseContents = await readFile(paths.stateDatabase);
    expect(databaseContents.includes(Buffer.from(firstSecret.trim()))).toBe(
      false,
    );

    const database = new DatabaseSync(paths.stateDatabase, { readOnly: true });
    expect(database.prepare("PRAGMA foreign_keys").get()).toEqual({
      foreign_keys: 1,
    });
    expect(database.prepare("PRAGMA journal_mode").get()).toEqual({
      journal_mode: "wal",
    });
    expect(
      database
        .prepare(
          "SELECT id AS version, name, length(hash) AS checksum_length FROM __drizzle_migrations ORDER BY id",
        )
        .all(),
    ).toEqual([
      {
        checksum_length: 64,
        name: createEnvironmentMigration.name,
        version: 1,
      },
      {
        checksum_length: 64,
        name: createActivityMigration.name,
        version: 2,
      },
      {
        checksum_length: 64,
        name: createAuthorizationCapabilitiesMigration.name,
        version: 3,
      },
      {
        checksum_length: 64,
        name: createRepositoryCatalogMigration.name,
        version: 4,
      },
      {
        checksum_length: 64,
        name: addLogicalRepositoryIdentityMigration.name,
        version: 5,
      },
    ]);
    database.close();

    if (process.platform !== "win32") {
      for (const directory of [
        paths.root,
        paths.stateDirectory,
        paths.runtimeDirectory,
        paths.settingsDirectory,
        paths.secretsDirectory,
        paths.cacheDirectory,
      ]) {
        expect((await stat(directory)).mode & 0o777).toBe(0o700);
      }
      expect((await stat(paths.serverSecret)).mode & 0o777).toBe(0o600);
      expect((await stat(paths.stateDatabase)).mode & 0o777).toBe(0o600);
    }
  });

  it("upgrades a version-two database", async () => {
    const paths = await createTemporaryPaths();
    await mkdir(paths.stateDirectory, { mode: 0o700, recursive: true });
    const database = new DatabaseSync(paths.stateDatabase);
    for (const statement of createEnvironmentMigration.sql) {
      database.exec(statement);
    }
    for (const statement of createActivityMigration.sql) {
      database.exec(statement);
    }
    createMigrationHistory(database);
    recordMigration(
      database,
      generatedMigrationEntry(createEnvironmentMigration, 1),
    );
    recordMigration(
      database,
      generatedMigrationEntry(createActivityMigration, 2),
    );
    const environmentId = randomUUID();
    database
      .prepare(
        "INSERT INTO environment (singleton, id, automatic_port) VALUES (1, ?, 43123)",
      )
      .run(environmentId);
    database
      .prepare(
        "INSERT INTO authorization_metadata (id, label, role, created_at) VALUES (?, ?, 'reader', ?)",
      )
      .run("legacy-device", "Legacy device", "2026-08-20T10:00:00.000Z");
    database.close();

    const state = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const context = yield* acquireEnvironmentContext(paths);
          const environment = yield* readCurrentEnvironment(context);
          return {
            automaticPort: environment.automaticPort,
            authorizations: yield* context.read(
              "Could not read authorization metadata",
              (database) =>
                database
                  .select()
                  .from(authorizationMetadataTable)
                  .where(isActiveAuthorization())
                  .orderBy(authorizationMetadataTable.createdAt),
            ),
            environmentId: environment.id,
          };
        }),
      ),
    );

    expect(state).toEqual({
      automaticPort: 43123,
      authorizations: [
        {
          createdAt: "2026-08-20T10:00:00.000Z",
          id: "legacy-device",
          label: "Legacy device",
          lastSeenAt: null,
          revokedAt: null,
          role: "viewer",
        },
      ],
      environmentId,
    });
  });

  it("rejects changed migration checksums", async () => {
    const checksumPaths = await createTemporaryPaths();
    await seedMigrationHistory(checksumPaths.stateDatabase, [
      {
        ...generatedMigrationEntry(createEnvironmentMigration, 1),
        checksum: "changed",
      },
    ]);

    await expect(openState(checksumPaths)).rejects.toThrow(
      `Migration 1 "${createEnvironmentMigration.name}" no longer matches its applied checksum.`,
    );
  });

  it("rejects newer migration versions", async () => {
    const newerPaths = await createTemporaryPaths();
    await seedMigrationHistory(newerPaths.stateDatabase, [
      generatedMigrationEntry(createEnvironmentMigration, 1),
      generatedMigrationEntry(createActivityMigration, 2),
      generatedMigrationEntry(createAuthorizationCapabilitiesMigration, 3),
      generatedMigrationEntry(createRepositoryCatalogMigration, 4),
      generatedMigrationEntry(addLogicalRepositoryIdentityMigration, 5),
      {
        checksum: "future",
        createdAt: addLogicalRepositoryIdentityMigration.folderMillis + 1,
        name: "future",
        version: 6,
      },
    ]);

    await expect(openState(newerPaths)).rejects.toThrow(
      "The state database is at version 6, but this Rebase build supports version 5.",
    );
  });

  it("recovers from an interrupted migration transaction", async () => {
    const paths = await createTemporaryPaths();
    await mkdir(paths.stateDirectory, { mode: 0o700, recursive: true });
    const interrupted = new DatabaseSync(paths.stateDatabase);
    interrupted.exec(
      "BEGIN IMMEDIATE; CREATE TABLE interrupted_startup (id INTEGER PRIMARY KEY) STRICT;",
    );
    interrupted.close();

    await openState(paths);

    const database = new DatabaseSync(paths.stateDatabase, { readOnly: true });
    expect(
      database
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'interrupted_startup'",
        )
        .get(),
    ).toBeUndefined();
    expect(
      database
        .prepare("SELECT max(id) AS version FROM __drizzle_migrations")
        .get(),
    ).toEqual({ version: 5 });
    database.close();
  });

  it("serializes writers and bounds operation activity", async () => {
    const paths = await createTemporaryPaths();
    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const context = yield* acquireEnvironmentContext(paths);
          yield* saveAutomaticPort(context);
          yield* saveAuthorizationMetadata(context);
          yield* saveConcurrentOperationActivity(context);
          return yield* readActiveMetadata(context);
        }),
      ),
    );

    expect(result.authorizations).toEqual([
      {
        createdAt: "2026-08-20T10:00:00.000Z",
        id: "device-one",
        label: "Alex's laptop",
        lastSeenAt: "2026-08-20T11:00:00.000Z",
        revokedAt: null,
        role: "owner",
      },
    ]);
    expect(result.operations).toHaveLength(operationActivityLimit);
    expect(result.operations[0]?.id).toBe("operation-249");
    expect(result.operations.at(-1)?.id).toBe("operation-050");

    const reopenedPort = await readAutomaticPort(paths);
    expect(reopenedPort).toBe(40123);
  });
});

function saveAutomaticPort(context: EnvironmentContext) {
  return context.write("Could not save the automatic port", (database) =>
    database
      .update(environmentTable)
      .set({ automaticPort: 40123 })
      .where(and(isCurrentEnvironment(), hasNoAutomaticPort())),
  );
}

function saveAuthorizationMetadata(context: EnvironmentContext) {
  const authorizationChanges = {
    createdAt: "2026-08-20T10:00:00.000Z",
    label: "Alex's laptop",
    lastSeenAt: "2026-08-20T11:00:00.000Z",
    revokedAt: null,
    role: "owner" as const,
  };
  return context.write("Could not save authorization metadata", (database) =>
    database
      .insert(authorizationMetadataTable)
      .values({ id: "device-one", ...authorizationChanges })
      .onConflictDoUpdate({
        set: authorizationChanges,
        target: authorizationMetadataTable.id,
      }),
  );
}

function saveConcurrentOperationActivity(context: EnvironmentContext) {
  return Effect.all(
    Array.from({ length: operationActivityLimit + 50 }, (_, index) =>
      saveOperationActivity(context, index),
    ),
    { concurrency: "unbounded" },
  );
}

function saveOperationActivity(context: EnvironmentContext, index: number) {
  return context.write("Could not save operation activity", (database) =>
    database.transaction(
      (transaction) => {
        const activity = {
          finishedAt: null,
          id: `operation-${index.toString().padStart(3, "0")}`,
          kind: "test",
          startedAt: new Date(index * 1_000).toISOString(),
          status: "running" as const,
        };
        transaction
          .insert(operationActivityTable)
          .values(activity)
          .onConflictDoUpdate({
            set: activity,
            target: operationActivityTable.id,
          })
          .run();
        const retainedActivity = transaction
          .select({ id: operationActivityTable.id })
          .from(operationActivityTable)
          .orderBy(
            desc(operationActivityTable.startedAt),
            desc(operationActivityTable.id),
          )
          .limit(operationActivityLimit);
        transaction
          .delete(operationActivityTable)
          .where(notInArray(operationActivityTable.id, retainedActivity))
          .run();
      },
      { behavior: "immediate" },
    ),
  );
}

function readActiveMetadata(context: EnvironmentContext) {
  return Effect.gen(function* () {
    return {
      authorizations: yield* context.read(
        "Could not read authorization metadata",
        (database) =>
          database
            .select()
            .from(authorizationMetadataTable)
            .where(isActiveAuthorization())
            .orderBy(authorizationMetadataTable.createdAt),
      ),
      operations: yield* context.read(
        "Could not read operation activity",
        (database) =>
          database
            .select()
            .from(operationActivityTable)
            .where(hasOperationStatus("running"))
            .orderBy(
              desc(operationActivityTable.startedAt),
              desc(operationActivityTable.id),
            ),
      ),
    };
  });
}

function readAutomaticPort(paths: ReturnType<typeof environmentPaths>) {
  return Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const context = yield* acquireEnvironmentContext(paths);
        const environment = yield* readCurrentEnvironment(context);
        return environment.automaticPort;
      }),
    ),
  );
}

async function createTemporaryPaths() {
  const directory = await mkdtemp(join(tmpdir(), "rebase state șț "));
  directories.add(directory);
  return environmentPaths(join(directory, ".rebase"));
}

async function seedMigrationHistory(
  databasePath: string,
  migrations: readonly MigrationHistoryEntry[],
) {
  await mkdir(dirname(databasePath), { recursive: true });
  const database = new DatabaseSync(databasePath);
  createMigrationHistory(database);
  for (const migration of migrations) recordMigration(database, migration);
  database.close();
}

interface MigrationHistoryEntry {
  readonly checksum: string;
  readonly createdAt: number;
  readonly name: string;
  readonly version: number;
}

function createMigrationHistory(database: DatabaseSync) {
  database.exec(`
    CREATE TABLE __drizzle_migrations (
      id INTEGER PRIMARY KEY,
      hash text NOT NULL,
      created_at numeric,
      name text,
      applied_at TEXT
    );
  `);
}

function recordMigration(
  database: DatabaseSync,
  migration: MigrationHistoryEntry,
) {
  database
    .prepare(
      "INSERT INTO __drizzle_migrations (id, hash, created_at, name, applied_at) VALUES (?, ?, ?, ?, ?)",
    )
    .run(
      migration.version,
      migration.checksum,
      migration.createdAt,
      migration.name,
      "2026-08-19T00:00:00.000Z",
    );
}

function generatedMigrationEntry(
  migration: MigrationMeta,
  version: number,
): MigrationHistoryEntry {
  return {
    checksum: migration.hash,
    createdAt: migration.folderMillis,
    name: migration.name,
    version,
  };
}

function openState(paths: ReturnType<typeof environmentPaths>) {
  return Effect.runPromise(
    Effect.scoped(acquireEnvironmentContext(paths).pipe(Effect.asVoid)),
  );
}

function readCurrentEnvironment(context: EnvironmentContext) {
  return context.read("Could not read Environment state", async (database) => {
    const environment = await database
      .select()
      .from(environmentTable)
      .where(isCurrentEnvironment())
      .get();
    if (environment === undefined) {
      throw new Error("The Environment identity is missing.");
    }
    return environment;
  });
}
