import { RepositoryPushApi } from "@rebase/contracts";
import type { EnvironmentFeature } from "#server/adapters/environment-transport/environment-routes";
import {
  type RepositoryDependencies,
  repositoryRoutes,
} from "#server/adapters/environment-transport/environment-routes";
import { pushRemoteBranch } from "#server/features/repository-push/git/push-remote-branch";

export function repositoryPushFeature(
  dependencies: RepositoryDependencies,
): EnvironmentFeature {
  const { command } = repositoryRoutes(dependencies);
  return {
    routes: [
      command(
        RepositoryPushApi.push,
        { name: "push", locks: { refs: "wait" }, duringOperation: "block" },
        (input, git) => pushRemoteBranch(git, input),
      ),
    ],
  };
}
