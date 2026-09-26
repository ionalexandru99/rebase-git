import { RepositoryOperationsHttpApi } from "@rebase/contracts";
import { Effect } from "effect";
import type { EnvironmentFeature } from "#server/adapters/environment-transport/environment-feature.contract";
import {
  command,
  query,
} from "#server/adapters/environment-transport/http/repository-http-routes";
import { RepositoryCoordination } from "#server/domain/repository-coordination.contract";
import { recoverRepositoryOperation } from "#server/features/repository-operations/git/recover-operation";

export const repositoryOperationsFeature = Effect.gen(function* () {
  const coordination = yield* RepositoryCoordination;
  const api = RepositoryOperationsHttpApi;
  return {
    capabilities: [],
    httpRoutes: [
      yield* query(api.read, (input) =>
        coordination.operation(input.worktreePath),
      ),
      yield* command(
        api.execute,
        {
          name: "recover",
          locks: { refs: "wait", worktree: "wait" },
          duringOperation: "proceed",
        },
        (input, git) => recoverRepositoryOperation(git, coordination, input),
      ),
    ],
  } satisfies EnvironmentFeature;
});
