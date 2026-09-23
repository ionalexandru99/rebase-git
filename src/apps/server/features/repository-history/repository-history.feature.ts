import { Effect } from "effect";
import type { EnvironmentFeature } from "#server/adapters/environment-transport/environment-feature.contract";
import { GitCommands } from "#server/domain/git-command.contract";
import { RepositoryAccess } from "#server/domain/repository-access.contract";
import { acquireRepositoryFreshness } from "#server/features/repository-history/freshness/repository-freshness";
import { createRepositoryHistoryService } from "#server/features/repository-history/repository-history";
import { repositoryFreshnessRpc } from "#server/features/repository-history/rpc/repository-freshness-rpc";
import { repositoryHistoryRpc } from "#server/features/repository-history/rpc/repository-history-rpc";

export const repositoryHistoryFeature = Effect.gen(function* () {
  const history = createRepositoryHistoryService({
    access: yield* RepositoryAccess,
    git: yield* GitCommands,
  });
  return {
    capabilities: ["repository-history"],
    httpRoutes: [],
    rpc: (session) => repositoryHistoryRpc(session, history),
  } satisfies EnvironmentFeature;
});

export const repositoryFreshnessFeature = Effect.gen(function* () {
  const freshness = yield* acquireRepositoryFreshness;
  return {
    capabilities: ["repository-history-freshness"],
    httpRoutes: [],
    rpc: (session) => repositoryFreshnessRpc(session, freshness),
  } satisfies EnvironmentFeature;
});
