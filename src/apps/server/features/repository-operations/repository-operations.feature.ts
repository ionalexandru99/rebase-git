import { RepositoryOperationsHttpApi } from "@rebase/contracts";
import type { EnvironmentFeature } from "#server/adapters/environment-transport/combine-environment-features";
import {
  type RepositoryDependencies,
  repositoryRoutes,
} from "#server/adapters/environment-transport/http/repository-http-routes";
import { recoverRepositoryOperation } from "#server/features/repository-operations/recover-operation";

export function repositoryOperationsFeature(
  dependencies: RepositoryDependencies,
): EnvironmentFeature {
  const { command, query } = repositoryRoutes(dependencies);
  const { coordination } = dependencies;
  const api = RepositoryOperationsHttpApi;
  return {
    capabilities: [],
    httpRoutes: [
      query(api.read, (input) => coordination.operation(input.worktreePath)),
      command(
        api.execute,
        {
          name: "recover",
          locks: { refs: "wait", worktree: "wait" },
          duringOperation: "proceed",
        },
        (input, git) => recoverRepositoryOperation(git, coordination, input),
      ),
    ],
  };
}
