import { eq, sql } from "drizzle-orm";
import { Effect } from "effect";
import type {
  PullStrategy,
  RepositoryPullStrategy,
} from "#contracts/repository-pull/repository-pull.contract.ts";
import type { EnvironmentContext } from "#server/persistence/environment-context.ts";
import {
  repositoryCatalogTable,
  repositorySettingTable,
  serverSettingTable,
} from "#server/persistence/environment-state.schema.ts";
import type { RepositoryAccess } from "#server/repository/repository-access.ts";

export type PullStrategies = ReturnType<typeof createPullStrategies>;

export function createPullStrategies(
  context: EnvironmentContext,
  access: RepositoryAccess,
) {
  const server = context
    .read("Could not read the pull setting", (database) =>
      database
        .select({ strategy: serverSettingTable.pullStrategy })
        .from(serverSettingTable)
        .get(),
    )
    .pipe(Effect.map((row): PullStrategy => row?.strategy ?? "ask"));

  const logicalRepositoryId = (repositoryId: string) =>
    access
      .repository(repositoryId)
      .pipe(Effect.map((entry) => entry.logicalRepositoryId ?? entry.id));

  const repository = (repositoryId: string) =>
    Effect.gen(function* () {
      const logicalId = yield* logicalRepositoryId(repositoryId);
      const row = yield* context.read(
        "Could not read the repository pull setting",
        (database) =>
          database
            .select({ strategy: repositorySettingTable.pullStrategy })
            .from(repositorySettingTable)
            .where(eq(repositorySettingTable.repositoryId, logicalId))
            .get(),
      );
      return {
        repository: row?.strategy ?? null,
        server: yield* server,
      } satisfies RepositoryPullStrategy;
    });

  return {
    server,
    effective: (repositoryId: string) =>
      repository(repositoryId).pipe(
        Effect.map(({ repository, server }) => repository ?? server),
      ),
    saveServer: (strategy: PullStrategy) =>
      context.write("Could not save the pull setting", (database) =>
        database
          .insert(serverSettingTable)
          .values({ singleton: 1, pullStrategy: strategy })
          .onConflictDoUpdate({
            target: serverSettingTable.singleton,
            set: { pullStrategy: strategy },
          }),
      ),
    repository,
    saveRepository: (repositoryId: string, strategy: PullStrategy | null) =>
      Effect.gen(function* () {
        const logicalId = yield* logicalRepositoryId(repositoryId);
        return yield* context.write(
          "Could not save the repository pull setting",
          async (database) => {
            if (strategy === null) {
              await database
                .delete(repositorySettingTable)
                .where(eq(repositorySettingTable.repositoryId, logicalId));
            } else {
              await database
                .insert(repositorySettingTable)
                .values({ repositoryId: logicalId, pullStrategy: strategy })
                .onConflictDoUpdate({
                  target: repositorySettingTable.repositoryId,
                  set: { pullStrategy: strategy },
                });
            }
            const repositories = await database
              .select({ id: repositoryCatalogTable.id })
              .from(repositoryCatalogTable)
              .where(
                eq(
                  sql`coalesce(${repositoryCatalogTable.logicalRepositoryId}, ${repositoryCatalogTable.id})`,
                  logicalId,
                ),
              );
            return repositories.map(({ id }) => id);
          },
        );
      }),
  };
}
