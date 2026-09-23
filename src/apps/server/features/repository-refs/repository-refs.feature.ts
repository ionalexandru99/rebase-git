import { RepositoryRefsHttpApi, RepositoryRefsRpc } from "@rebase/contracts";
import { Effect } from "effect";
import type { EnvironmentFeature } from "#server/adapters/environment-transport/environment-feature.contract";
import { httpRoute } from "#server/adapters/environment-transport/http/environment-http-route-handler";
import { environmentFeatureRpc } from "#server/adapters/environment-transport/rpc/environment-feature-rpc";
import { EnvironmentEvents } from "#server/domain/environment-event-publisher.contract";
import { GitCommands } from "#server/domain/git-command.contract";
import { RepositoryAccess } from "#server/domain/repository-access.contract";
import { RepositoryCoordination } from "#server/domain/repository-coordination.contract";
import { RepositoryWatching } from "#server/domain/repository-watcher.contract";
import type { RepositoryRefsError } from "#server/features/repository-refs/git/repository-refs-failures";
import { acquireRepositoryChangePublisher } from "#server/features/repository-refs/repository-change-publisher";
import { createRepositoryRefsService } from "#server/features/repository-refs/repository-refs";
import { repositoryRefsRpc } from "#server/features/repository-refs/rpc/repository-refs-rpc";

export const repositoryRefsFeature = Effect.gen(function* () {
  const git = yield* GitCommands;
  const refs = createRepositoryRefsService({
    access: yield* RepositoryAccess,
    changes: yield* acquireRepositoryChangePublisher(
      git,
      yield* RepositoryWatching,
      yield* EnvironmentEvents,
    ),
    git,
    coordination: yield* RepositoryCoordination,
  });
  return {
    capabilities: ["repository-refs"],
    httpRoutes: [
      httpRoute(
        RepositoryRefsHttpApi.checkout,
        (command) => refs.checkout(command),
        { failureStatus },
      ),
    ],
    rpc: environmentFeatureRpc(RepositoryRefsRpc, (session) =>
      repositoryRefsRpc(session, refs),
    ),
  } satisfies EnvironmentFeature;
});

function failureStatus(error: RepositoryRefsError) {
  switch (error.failure._tag) {
    case "RepositoryMissing":
    case "WorktreeMissing":
    case "RefMissing":
      return 404;
    case "BranchCheckedOutElsewhere":
    case "CheckoutRejected":
      return 409;
    case "GitFailed":
      return 422;
  }
}
