import { RepositoryRefsRpc } from "@rebase/contracts";
import type { EnvironmentFeature } from "#server/adapters/environment-transport/environment-feature.contract";
import { environmentFeatureRpc } from "#server/adapters/environment-transport/rpc/environment-feature-rpc";
import type { RepositoryRefsService } from "#server/domain/repository-refs.contract";
import { repositoryRefsHttpRoutes } from "#server/features/repository-refs/http/repository-refs-http-routes";
import { repositoryRefsRpc } from "#server/features/repository-refs/rpc/repository-refs-rpc";

export function repositoryRefsFeature(
  refs: RepositoryRefsService,
): EnvironmentFeature {
  return {
    capabilities: ["repository-refs"],
    httpRoutes: repositoryRefsHttpRoutes(refs),
    rpc: environmentFeatureRpc(RepositoryRefsRpc, (session) =>
      repositoryRefsRpc(session, refs),
    ),
  };
}
