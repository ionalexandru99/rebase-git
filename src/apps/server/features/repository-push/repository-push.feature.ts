import { RepositoryPushHttpApi } from "@rebase/contracts";
import { Effect } from "effect";
import type { EnvironmentFeature } from "#server/adapters/environment-transport/environment-feature.contract";
import { command } from "#server/adapters/environment-transport/http/repository-http-routes";
import { pushRemoteBranch } from "#server/features/repository-push/git/push-remote-branch";

export const repositoryPushFeature = Effect.gen(function* () {
  return {
    capabilities: [],
    httpRoutes: [
      yield* command(
        RepositoryPushHttpApi.push,
        { name: "push", locks: { refs: "wait" }, duringOperation: "block" },
        (input, git) => pushRemoteBranch(git, input),
      ),
    ],
  } satisfies EnvironmentFeature;
});
