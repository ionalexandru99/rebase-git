import { Effect } from "effect";
import type { EnvironmentFeature } from "#server/adapters/environment-transport/environment-routes";
import type { GitCommandRunner } from "#server/adapters/local-git/git-commands";
import type { RepositoryWatcher } from "#server/adapters/local-git/local-repository-watcher";
import { acquireRepositoryFreshness } from "#server/features/repository-history/freshness/repository-freshness";
import { createRepositoryHistoryService } from "#server/features/repository-history/repository-history";
import { repositoryFreshnessRpc } from "#server/features/repository-history/rpc/repository-freshness-rpc";
import { repositoryHistoryRpc } from "#server/features/repository-history/rpc/repository-history-rpc";
import type { RepositoryAccess } from "#server/repository/repository-access";
import type { RepositoryCoordination } from "#server/repository/repository-coordination";

export function repositoryHistoryFeature(dependencies: {
  readonly access: RepositoryAccess;
  readonly git: GitCommandRunner;
}) {
  const history = createRepositoryHistoryService(dependencies);
  return {
    routes: [],
    rpc: () => repositoryHistoryRpc(history),
  } satisfies EnvironmentFeature;
}

export function repositoryFreshnessFeature(dependencies: {
  readonly access: RepositoryAccess;
  readonly coordination: RepositoryCoordination;
  readonly git: GitCommandRunner;
  readonly watcher: RepositoryWatcher;
}) {
  return Effect.map(
    acquireRepositoryFreshness(dependencies),
    (freshness) =>
      ({
        routes: [],
        rpc: () => repositoryFreshnessRpc(freshness),
      }) satisfies EnvironmentFeature,
  );
}
