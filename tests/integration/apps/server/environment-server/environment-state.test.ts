import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  acquireEnvironmentState,
  operationActivityLimit,
} from "@rebase/server/environment-server/state/environment-state";
import { environmentPaths } from "@rebase/server/environment-server/storage/environment-paths";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

const directories = new Set<string>();

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
          const state = yield* acquireEnvironmentState(paths);
          return {
            automaticPort: state.automaticPort,
            databaseSettings: state.databaseSettings,
            environmentId: state.environmentId,
          };
        }),
      ),
    );
    const firstSecret = await readFile(paths.serverSecret, "utf8");

    const second = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const state = yield* acquireEnvironmentState(paths);
          return {
            automaticPort: state.automaticPort,
            databaseSettings: state.databaseSettings,
            environmentId: state.environmentId,
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
          "SELECT version, name, length(checksum) AS checksum_length FROM migration_history ORDER BY version",
        )
        .all(),
    ).toEqual([
      { checksum_length: 64, name: "create_environment", version: 1 },
      { checksum_length: 64, name: "create_activity", version: 2 },
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

  it("upgrades a version-one database", async () => {
    const paths = await createTemporaryPaths();
    await mkdir(paths.stateDirectory, { mode: 0o700, recursive: true });
    const database = new DatabaseSync(paths.stateDatabase);
    database.exec(`
      CREATE TABLE migration_history (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        checksum TEXT NOT NULL,
        applied_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE environment (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        id TEXT NOT NULL UNIQUE,
        automatic_port INTEGER CHECK (automatic_port BETWEEN 1 AND 65535)
      ) STRICT;
    `);
    const environmentId = randomUUID();
    database
      .prepare(
        "INSERT INTO environment (singleton, id, automatic_port) VALUES (1, ?, 43123)",
      )
      .run(environmentId);
    database
      .prepare(
        "INSERT INTO migration_history (version, name, checksum, applied_at) VALUES (1, 'create_environment', ?, '2026-08-19T00:00:00.000Z')",
      )
      .run("ff4fedc1259d313174a7ac4ba918f52db0d7a89af8021d1b4ae68a90c39f539e");
    database.close();

    const state = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const opened = yield* acquireEnvironmentState(paths);
          return {
            automaticPort: opened.automaticPort,
            authorizations: yield* opened.listAuthorizations,
            environmentId: opened.environmentId,
          };
        }),
      ),
    );

    expect(state).toEqual({
      automaticPort: 43123,
      authorizations: [],
      environmentId,
    });
  });

  it("rejects changed and newer migrations", async () => {
    const checksumPaths = await createTemporaryPaths();
    await seedMigrationHistory(checksumPaths.stateDatabase, {
      checksum: "changed",
      name: "create_environment",
      version: 1,
    });

    await expect(openState(checksumPaths)).rejects.toThrow(
      'Migration 1 "create_environment" no longer matches its applied checksum.',
    );

    const newerPaths = await createTemporaryPaths();
    await seedMigrationHistory(newerPaths.stateDatabase, {
      checksum: "future",
      name: "future",
      version: 3,
    });

    await expect(openState(newerPaths)).rejects.toThrow(
      "The state database is at version 3, but this Rebase build supports version 2.",
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
        .prepare("SELECT max(version) AS version FROM migration_history")
        .get(),
    ).toEqual({ version: 2 });
    database.close();
  });

  it("serializes writers and bounds operation activity", async () => {
    const paths = await createTemporaryPaths();
    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const state = yield* acquireEnvironmentState(paths);
          yield* state.selectAutomaticPort(40123);
          yield* state.saveAuthorization({
            createdAt: "2026-08-20T10:00:00.000Z",
            id: "device-one",
            label: "Alex's laptop",
            lastSeenAt: "2026-08-20T11:00:00.000Z",
            revokedAt: null,
            role: "owner",
          });

          yield* Effect.all(
            Array.from({ length: operationActivityLimit + 50 }, (_, index) =>
              state.recordOperationActivity({
                finishedAt: null,
                id: `operation-${index.toString().padStart(3, "0")}`,
                kind: "test",
                startedAt: new Date(index * 1_000).toISOString(),
                status: "running",
              }),
            ),
            { concurrency: "unbounded" },
          );

          return {
            authorizations: yield* state.listAuthorizations,
            operations: yield* state.listOperationActivity,
          };
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

    const reopenedPort = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const state = yield* acquireEnvironmentState(paths);
          return state.automaticPort;
        }),
      ),
    );
    expect(reopenedPort).toBe(40123);
  });
});

async function createTemporaryPaths() {
  const directory = await mkdtemp(join(tmpdir(), "rebase state șț "));
  directories.add(directory);
  return environmentPaths(join(directory, ".rebase"));
}

async function seedMigrationHistory(
  databasePath: string,
  migration: { checksum: string; name: string; version: number },
) {
  await mkdir(dirname(databasePath), { recursive: true });
  const database = new DatabaseSync(databasePath);
  database.exec(`
    CREATE TABLE migration_history (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      checksum TEXT NOT NULL,
      applied_at TEXT NOT NULL
    ) STRICT;
  `);
  database
    .prepare(
      "INSERT INTO migration_history (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)",
    )
    .run(
      migration.version,
      migration.name,
      migration.checksum,
      "2026-08-19T00:00:00.000Z",
    );
  database.close();
}

function openState(paths: ReturnType<typeof environmentPaths>) {
  return Effect.runPromise(
    Effect.scoped(acquireEnvironmentState(paths).pipe(Effect.asVoid)),
  );
}
