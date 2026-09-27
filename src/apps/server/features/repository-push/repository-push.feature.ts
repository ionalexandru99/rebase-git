import { RepositoryPushHttpApi } from "@rebase/contracts";
import type { EnvironmentFeature } from "#server/adapters/environment-transport/combine-environment-features";
import {
  type RepositoryDependencies,
  repositoryRoutes,
} from "#server/adapters/environment-transport/http/repository-http-routes";
import { pushRemoteBranch } from "#server/features/repository-push/git/push-remote-branch";

export function repositoryPushFeature(
  dependencies: RepositoryDependencies,
): EnvironmentFeature {
  const { command } = repositoryRoutes(dependencies);
  return {
    capabilities: [],
    httpRoutes: [
      command(
        RepositoryPushHttpApi.push,
        { name: "push", locks: { refs: "wait" }, duringOperation: "block" },
        (input, git) => pushRemoteBranch(git, input),
      ),
    ],
  };
}
