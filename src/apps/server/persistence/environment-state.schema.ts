import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";
import { RepositoryColor } from "#contracts/repository-catalog/repository-catalog.contract.ts";
import { PullStrategy } from "#contracts/repository-pull/repository-pull.contract.ts";

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
  },
);

export const repositoryCatalogTable = sqliteTable(
  "repository_catalog",
  {
    addedAt: text("added_at").notNull(),
    color: text("color", { enum: RepositoryColor.literals })
      .notNull()
      .default("blue"),
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

export const gitHostTable = sqliteTable("git_host", {
  enabled: integer("enabled", { mode: "boolean" }).notNull(),
  kind: text("kind").primaryKey(),
});

export const bitbucketTokenTable = sqliteTable(
  "bitbucket_token",
  {
    account: text("account"),
    email: text("email"),
    singleton: integer("singleton").primaryKey(),
    token: text("token").notNull(),
  },
  (token) => [
    check("bitbucket_token_singleton_check", sql`${token.singleton} = 1`),
  ],
);

export const serverSettingTable = sqliteTable(
  "server_setting",
  {
    cloneFolder: text("clone_folder"),
    pullStrategy: text("pull_strategy", { enum: PullStrategy.literals })
      .notNull()
      .default("ask"),
    singleton: integer("singleton").primaryKey(),
  },
  (setting) => [
    check("server_setting_singleton_check", sql`${setting.singleton} = 1`),
  ],
);

export const repositorySettingTable = sqliteTable("repository_setting", {
  pullStrategy: text("pull_strategy", {
    enum: PullStrategy.literals,
  }).notNull(),
  repositoryId: text("repository_id").primaryKey(),
});
