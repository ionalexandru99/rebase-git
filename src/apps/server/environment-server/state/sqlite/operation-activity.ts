import type { DatabaseSync } from "node:sqlite";
import type { OperationActivity } from "@rebase/server/environment-server/state/environment-state.contract";
import { operationActivityTable } from "@rebase/server/environment-server/state/sqlite/schema";
import { runInImmediateTransaction } from "@rebase/server/environment-server/state/sqlite/transaction";
import { desc } from "drizzle-orm";
import type { NodeSQLiteDatabase } from "drizzle-orm/node-sqlite";

export const operationActivityLimit = 200;

const upsertOperationActivitySql = `
  INSERT INTO operation_activity (id, kind, status, started_at, finished_at)
  VALUES (?, ?, ?, ?, ?)
  ON CONFLICT (id) DO UPDATE SET
    kind = excluded.kind,
    status = excluded.status,
    started_at = excluded.started_at,
    finished_at = excluded.finished_at
`;

const pruneOperationActivitySql = `
  DELETE FROM operation_activity
  WHERE id NOT IN (
    SELECT id
    FROM operation_activity
    ORDER BY started_at DESC, id DESC
    LIMIT ?
  )
`;

export function listOperationActivity(database: NodeSQLiteDatabase) {
  return database
    .select()
    .from(operationActivityTable)
    .orderBy(
      desc(operationActivityTable.startedAt),
      desc(operationActivityTable.id),
    );
}

export function saveOperationActivity(
  database: DatabaseSync,
  activity: OperationActivity,
) {
  runInImmediateTransaction(database, () => {
    database
      .prepare(upsertOperationActivitySql)
      .run(
        activity.id,
        activity.kind,
        activity.status,
        activity.startedAt,
        activity.finishedAt,
      );
    database.prepare(pruneOperationActivitySql).run(operationActivityLimit);
  });
}
