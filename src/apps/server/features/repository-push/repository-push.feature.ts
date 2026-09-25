import { RepositoryPushHttpApi } from "@rebase/contracts";
import { Effect } from "effect";
import type { EnvironmentFeature } from "#server/adapters/environment-transport/environment-feature.contract";
import { httpRoute } from "#server/adapters/environment-transport/http/environment-http-route-handler";
import { GitCommands } from "#server/domain/git-command.contract";
import { RepositoryAccess } from "#server/domain/repository-access.contract";
import { RepositoryCoordination } from "#server/domain/repository-coordination.contract";
import type { RepositoryPushError } from "#server/features/repository-push/git/push-failures";
import { createRepositoryPushService } from "#server/features/repository-push/repository-push";

export const repositoryPushFeature = Effect.gen(function* () {
  const push = createRepositoryPushService(
    yield* RepositoryAccess,
    yield* GitCommands,
    yield* RepositoryCoordination,
  );
  return {
    capabilities: [],
    httpRoutes: [
      httpRoute(RepositoryPushHttpApi.push, (command) => push.push(command), {
        failureStatus,
      }),
    ],
  } satisfies EnvironmentFeature;
});

function failureStatus({ failure }: RepositoryPushError) {
  switch (failure.reason) {
    case "Missing":
    case "RemoteMissing":
      return 404;
    case "InvalidBranch":
      return 422;
    default:
      return 409;
  }
}
