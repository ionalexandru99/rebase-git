import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { runInImmediateTransaction } from "@rebase/server/environment-server/state/sqlite/transaction";

const migrationDefinitions = [
  {
    name: "create_environment",
    sql: `
CREATE TABLE environment (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  id TEXT NOT NULL UNIQUE,
  automatic_port INTEGER CHECK (automatic_port BETWEEN 1 AND 65535)
) STRICT;
`,
  },
  {
    name: "create_activity",
    sql: `
CREATE TABLE authorization_metadata (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('reader', 'contributor', 'maintainer', 'owner')),
  created_at TEXT NOT NULL,
  last_seen_at TEXT,
  revoked_at TEXT
) STRICT;

CREATE TABLE operation_activity (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled', 'outcome_unknown')),
  started_at TEXT NOT NULL,
  finished_at TEXT
) STRICT;

CREATE INDEX operation_activity_started_at
ON operation_activity (started_at DESC, id DESC);
`,
  },
] as const;

const environmentStateMigrations = migrationDefinitions.map(
  (migration, index) => ({
    ...migration,
    checksum: createHash("sha256").update(migration.sql).digest("hex"),
    version: index + 1,
  }),
);

export function migrateEnvironmentState(database: DatabaseSync) {
  createMigrationHistory(database);
  const applied = readAppliedMigrations(database);
  validateMigrationHistory(applied);
  applyPendingMigrations(database, applied.length);
}

function createMigrationHistory(database: DatabaseSync) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS migration_history (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      checksum TEXT NOT NULL,
      applied_at TEXT NOT NULL
    ) STRICT;
  `);
}

function readAppliedMigrations(database: DatabaseSync) {
  return database
    .prepare(
      "SELECT version, name, checksum FROM migration_history ORDER BY version",
    )
    .all()
    .map(parseAppliedMigration);
}

function validateMigrationHistory(
  applied: readonly ReturnType<typeof parseAppliedMigration>[],
) {
  const latestApplied = applied.at(-1)?.version ?? 0;
  const latestSupported = environmentStateMigrations.length;

  if (latestApplied > latestSupported) {
    throw new Error(
      `The state database is at version ${latestApplied}, but this Rebase build supports version ${latestSupported}.`,
    );
  }

  for (const [index, migration] of applied.entries()) {
    if (migration.version !== index + 1) {
      throw new Error(
        `The state database has a gap before migration ${migration.version}.`,
      );
    }

    assertMigrationMatches(migration, environmentStateMigrations[index]);
  }
}

function applyPendingMigrations(database: DatabaseSync, appliedCount: number) {
  for (const migration of environmentStateMigrations.slice(appliedCount)) {
    applyMigration(database, migration);
  }
}

function applyMigration(
  database: DatabaseSync,
  migration: (typeof environmentStateMigrations)[number],
) {
  runInImmediateTransaction(database, () => {
    const applied = readAppliedMigration(database, migration.version);
    if (applied !== undefined) {
      assertMigrationMatches(applied, migration);
      return;
    }

    database.exec(migration.sql);
    recordMigration(database, migration);
  });
}

function readAppliedMigration(database: DatabaseSync, version: number) {
  const row = database
    .prepare(
      "SELECT version, name, checksum FROM migration_history WHERE version = ?",
    )
    .get(version);
  return row === undefined ? undefined : parseAppliedMigration(row);
}

function assertMigrationMatches(
  applied: ReturnType<typeof parseAppliedMigration>,
  expected: (typeof environmentStateMigrations)[number] | undefined,
) {
  if (
    expected === undefined ||
    applied.name !== expected.name ||
    applied.checksum !== expected.checksum
  ) {
    throw new Error(
      `Migration ${applied.version} "${applied.name}" no longer matches its applied checksum.`,
    );
  }
}

function recordMigration(
  database: DatabaseSync,
  migration: (typeof environmentStateMigrations)[number],
) {
  database
    .prepare(
      "INSERT INTO migration_history (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)",
    )
    .run(
      migration.version,
      migration.name,
      migration.checksum,
      new Date().toISOString(),
    );
}

function parseAppliedMigration(
  row: Record<string, string | number | bigint | Uint8Array | null>,
) {
  if (
    typeof row.version !== "number" ||
    typeof row.name !== "string" ||
    typeof row.checksum !== "string"
  ) {
    throw new Error("The migration history contains an invalid record.");
  }

  return {
    checksum: row.checksum,
    name: row.name,
    version: row.version,
  };
}
