import {
  environmentAccessCapabilities,
  environmentAuthorizationRoles,
} from "@rebase/contracts";
import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

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
    role: text("role", { enum: environmentAuthorizationRoles }).notNull(),
  },
  (authorization) => [
    check(
      "authorization_metadata_role_check",
      sql`${authorization.role} IN (${sql.raw(sqlValues(environmentAuthorizationRoles))})`,
    ),
  ],
);

export const authorizationCapabilityTable = sqliteTable(
  "authorization_capability",
  {
    authorizationId: text("authorization_id").notNull(),
    capability: text("capability", {
      enum: environmentAccessCapabilities,
    }).notNull(),
  },
  (authorizationCapability) => [
    primaryKey({
      columns: [
        authorizationCapability.authorizationId,
        authorizationCapability.capability,
      ],
    }),
    foreignKey({
      columns: [authorizationCapability.authorizationId],
      foreignColumns: [authorizationMetadataTable.id],
    }).onDelete("cascade"),
    check(
      "authorization_capability_value_check",
      sql`${authorizationCapability.capability} IN (${sql.raw(sqlValues(environmentAccessCapabilities))})`,
    ),
  ],
);

export const repositoryCatalogTable = sqliteTable(
  "repository_catalog",
  {
    addedAt: text("added_at").notNull(),
    gitCommonDirectory: text("git_common_directory"),
    id: text("id").primaryKey(),
    lastOpenedAt: text("last_opened_at").notNull(),
    logicalRepositoryId: text("logical_repository_id"),
    name: text("name").notNull(),
    path: text("path").notNull().unique(),
  },
  (repository) => [
    check(
      "repository_catalog_name_check",
      sql`length(${repository.name}) BETWEEN 1 AND 255`,
    ),
    check(
      "repository_catalog_path_check",
      sql`length(${repository.path}) BETWEEN 1 AND 4096`,
    ),
    index("repository_catalog_last_opened_at").on(
      sql`${repository.lastOpenedAt} DESC`,
      sql`${repository.id} DESC`,
    ),
    index("repository_catalog_logical_repository_id").on(
      repository.logicalRepositoryId,
    ),
    index("repository_catalog_name").on(repository.name, repository.path),
  ],
);

function sqlValues(values: readonly string[]) {
  return values.map((value) => `'${value.replaceAll("'", "''")}'`).join(", ");
}
