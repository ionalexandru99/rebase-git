import { eq, sql } from "drizzle-orm";
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
  const server = async (): Promise<PullStrategy> => {
    const row = await context.read(
      "Could not read the pull setting",
      (database) =>
        database
          .select({ strategy: serverSettingTable.pullStrategy })
          .from(serverSettingTable)
          .get(),
    );
    return row?.strategy ?? "ask";
  };

  const logicalRepositoryId = async (repositoryId: string) => {
    const entry = await access.repository(repositoryId);
    return entry.logicalRepositoryId ?? entry.id;
  };

  const repository = async (
    repositoryId: string,
  ): Promise<RepositoryPullStrategy> => {
    const logicalId = await logicalRepositoryId(repositoryId);
    const row = await context.read(
      "Could not read the repository pull setting",
      (database) =>
        database
          .select({ strategy: repositorySettingTable.pullStrategy })
          .from(repositorySettingTable)
          .where(eq(repositorySettingTable.repositoryId, logicalId))
          .get(),
    );
    return { repository: row?.strategy ?? null, server: await server() };
  };

  return {
    server,
    effective: async (repositoryId: string) => {
      const strategies = await repository(repositoryId);
      return strategies.repository ?? strategies.server;
    },
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
    saveRepository: async (
      repositoryId: string,
      strategy: PullStrategy | null,
    ) => {
      const logicalId = await logicalRepositoryId(repositoryId);
      return context.write(
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
    },
  };
}
