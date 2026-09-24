import { RepositoryPullHttpApi } from "@rebase/contracts";
import { Effect } from "effect";
import type { EnvironmentFeature } from "#server/adapters/environment-transport/environment-feature.contract";
import { httpRoute } from "#server/adapters/environment-transport/http/environment-http-route-handler";
import { GitCommands } from "#server/domain/git-command.contract";
import { RepositoryAccess } from "#server/domain/repository-access.contract";
import { RepositoryCoordination } from "#server/domain/repository-coordination.contract";
import type { RepositoryPullError } from "#server/features/repository-pull/git/pull-failures";
import { createRepositoryPullService } from "#server/features/repository-pull/repository-pull";

export const repositoryPullFeature = Effect.gen(function* () {
  const repositoryPull = createRepositoryPullService({
    access: yield* RepositoryAccess,
    git: yield* GitCommands,
    coordination: yield* RepositoryCoordination,
  });
  return {
    capabilities: [],
    httpRoutes: [
      httpRoute(
        RepositoryPullHttpApi.pull,
        (command) => repositoryPull.pull(command),
        { failureStatus },
      ),
    ],
  } satisfies EnvironmentFeature;
});

function failureStatus(error: RepositoryPullError) {
  switch (error.failure._tag) {
    case "RepositoryMissing":
    case "BranchMissing":
      return 404;
    case "GitFailed":
      return 422;
    default:
      return 409;
  }
}
