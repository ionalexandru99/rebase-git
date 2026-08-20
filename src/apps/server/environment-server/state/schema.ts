import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const authorizationRoles = [
  "reader",
  "contributor",
  "maintainer",
  "owner",
] as const;

export const operationStatuses = [
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
  "outcome_unknown",
] as const;

export const environmentTable = sqliteTable("environment", {
  automaticPort: integer("automatic_port"),
  id: text("id").notNull().unique(),
  singleton: integer("singleton").primaryKey(),
});

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
);

export const operationActivityTable = sqliteTable("operation_activity", {
  finishedAt: text("finished_at"),
  id: text("id").primaryKey(),
  kind: text("kind").notNull(),
  startedAt: text("started_at").notNull(),
  status: text("status", { enum: operationStatuses }).notNull(),
});
