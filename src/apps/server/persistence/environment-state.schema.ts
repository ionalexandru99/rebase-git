import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";
import {
  authorizationRoles,
  operationStatuses,
} from "#server/domain/environment-state.contract";

export const environmentTable = sqliteTable(
  "environment",
  {
    automaticPort: integer("automatic_port"),
    id: text("id").notNull().unique(),
    singleton: integer("singleton").primaryKey(),
  },
  (environment) => [
    check(
      "environment_automatic_port_check",
      sql`${environment.automaticPort} BETWEEN 1 AND 65535`,
    ),
    check("environment_singleton_check", sql`${environment.singleton} = 1`),
  ],
);

export const authorizationMetadataTable = sqliteTable(
  "authorization_metadata",
  {
    createdAt: text("created_at").notNull(),
    id: text("id").primaryKey(),
    label: text("label").notNull(),
    lastSeenAt: text("last_seen_at"),
    revokedAt: text("revoked_at"),
    role: text("role", { enum: authorizationRoles }).notNull(),
  },
  (authorization) => [
    check(
      "authorization_metadata_role_check",
      sql`${authorization.role} IN (${sql.raw(sqlValues(authorizationRoles))})`,
    ),
  ],
);

export const operationActivityTable = sqliteTable(
  "operation_activity",
  {
    finishedAt: text("finished_at"),
    id: text("id").primaryKey(),
    kind: text("kind").notNull(),
    startedAt: text("started_at").notNull(),
    status: text("status", { enum: operationStatuses }).notNull(),
  },
  (operation) => [
    check(
      "operation_activity_status_check",
      sql`${operation.status} IN (${sql.raw(sqlValues(operationStatuses))})`,
    ),
    index("operation_activity_started_at").on(
      sql`${operation.startedAt} DESC`,
      sql`${operation.id} DESC`,
    ),
  ],
);

function sqlValues(values: readonly string[]) {
  return values.map((value) => `'${value.replaceAll("'", "''")}'`).join(", ");
}
