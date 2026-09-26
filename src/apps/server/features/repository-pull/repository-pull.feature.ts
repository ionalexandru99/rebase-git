import { RepositoryPullHttpApi } from "@rebase/contracts";
import { Effect } from "effect";
import type { EnvironmentFeature } from "#server/adapters/environment-transport/environment-feature.contract";
import { command } from "#server/adapters/environment-transport/http/repository-http-routes";
import { RepositoryCoordination } from "#server/domain/repository-coordination.contract";
import { pullBranch } from "#server/features/repository-pull/repository-pull";

export const repositoryPullFeature = Effect.gen(function* () {
  const coordination = yield* RepositoryCoordination;
  return {
    capabilities: [],
    httpRoutes: [
      yield* command(
        RepositoryPullHttpApi.pull,
        {
          name: "pull",
          locks: { refs: "wait", worktree: "wait" },
          duringOperation: "block",
        },
        pullBranch(coordination),
      ),
    ],
  } satisfies EnvironmentFeature;
});
