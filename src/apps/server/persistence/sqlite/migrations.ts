import { existsSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { type MigrationMeta, readMigrationFiles } from "drizzle-orm/migrator";
import type { NodeSQLiteDatabase } from "drizzle-orm/node-sqlite";
import { migrate } from "drizzle-orm/node-sqlite/migrator";

const migrationsFolder = resolveMigrationsFolder();
const migrationsTable = "__drizzle_migrations";

interface AppliedMigration {
  readonly hash: string;
  readonly id: number;
  readonly name: string;
}

export function migrateEnvironmentState(
  database: NodeSQLiteDatabase & { readonly $client: DatabaseSync },
) {
  const localMigrations = readMigrationFiles({ migrationsFolder });
  const appliedMigrations = readAppliedMigrations(database.$client);
  validateMigrationHistory(localMigrations, appliedMigrations);
  if (appliedMigrations.length === localMigrations.length) return;

  try {
    migrate(database, { migrationsFolder, migrationsTable });
  } catch (error) {
    const migrationsAfterFailure = readAppliedMigrations(database.$client);
    validateMigrationHistory(localMigrations, migrationsAfterFailure);
    if (migrationsAfterFailure.length !== localMigrations.length) throw error;
  }
}

function readAppliedMigrations(database: DatabaseSync) {
  const tableExists = database
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(migrationsTable);
  if (tableExists === undefined) return [];

  return database
    .prepare(`SELECT id, name, hash FROM ${migrationsTable} ORDER BY id`)
    .all()
    .map(parseAppliedMigration);
}

function validateMigrationHistory(
  localMigrations: readonly MigrationMeta[],
  appliedMigrations: readonly AppliedMigration[],
) {
  for (const [index, applied] of appliedMigrations.entries()) {
    const expected = localMigrations[index];
    if (expected === undefined) {
      throw new Error(
        `The state database is at version ${applied.id}, but this Rebase build supports version ${localMigrations.length}.`,
      );
    }
    if (applied.id !== index + 1 || applied.name !== expected.name) {
      throw new Error(
        `Migration ${applied.id} "${applied.name}" does not match the expected migration "${expected.name}".`,
      );
    }
    if (applied.hash !== expected.hash) {
      throw new Error(
        `Migration ${applied.id} "${applied.name}" no longer matches its applied checksum.`,
      );
    }
  }
}

function parseAppliedMigration(row: Record<string, unknown>): AppliedMigration {
  if (
    typeof row.id !== "number" ||
    typeof row.name !== "string" ||
    typeof row.hash !== "string"
  ) {
    throw new Error("The migration history contains an invalid record.");
  }

  return {
    hash: row.hash,
    id: row.id,
    name: row.name,
  };
}

function resolveMigrationsFolder() {
  const candidates = [
    new URL("./migrations", import.meta.url),
    new URL("../migrations", import.meta.url),
  ];
  const folder = candidates.find((candidate) => existsSync(candidate));
  if (folder === undefined) {
    throw new Error("Rebase database migrations are missing.");
  }
  return fileURLToPath(folder);
}
