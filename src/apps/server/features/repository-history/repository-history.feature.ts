import type { EnvironmentFeature } from "#server/adapters/environment-transport/environment-feature.contract";
import type { RepositoryFreshnessService } from "#server/domain/repository-freshness.contract";
import type { RepositoryHistoryService } from "#server/domain/repository-history.contract";
import { repositoryFreshnessRpc } from "#server/features/repository-history/rpc/repository-freshness-rpc";
import { repositoryHistoryRpc } from "#server/features/repository-history/rpc/repository-history-rpc";

export function repositoryHistoryFeature(
  history: RepositoryHistoryService,
): EnvironmentFeature {
  return {
    capabilities: ["repository-history"],
    httpRoutes: [],
    rpcHandlers: (session) => repositoryHistoryRpc(session, history),
  };
}

export function repositoryFreshnessFeature(
  freshness: RepositoryFreshnessService,
): EnvironmentFeature {
  return {
    capabilities: ["repository-history-freshness"],
    httpRoutes: [],
    rpcHandlers: (session) => repositoryFreshnessRpc(session, freshness),
  };
}
