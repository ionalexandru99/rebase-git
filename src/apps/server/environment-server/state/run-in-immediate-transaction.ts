import type { DatabaseSync } from "node:sqlite";

export function runInImmediateTransaction<A>(
  database: DatabaseSync,
  operation: () => A,
) {
  database.exec("BEGIN IMMEDIATE");
  try {
    const result = operation();
    database.exec("COMMIT");
    return result;
  } catch (error) {
    if (database.isTransaction) {
      database.exec("ROLLBACK");
    }
    throw error;
  }
}
