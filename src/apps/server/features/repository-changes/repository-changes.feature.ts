import { RepositoryChangesHttpApi } from "@rebase/contracts";
import { Effect } from "effect";
import type { EnvironmentFeature } from "#server/adapters/environment-transport/environment-feature.contract";
import { httpRoute } from "#server/adapters/environment-transport/http/environment-http-route-handler";
import { GitCommands } from "#server/domain/git-command.contract";
import { RepositoryAccess } from "#server/domain/repository-access.contract";
import { RepositoryCoordination } from "#server/domain/repository-coordination.contract";
import type { RepositoryChangesError } from "#server/features/repository-changes/git/change-failures";
import { createRepositoryChangesService } from "#server/features/repository-changes/repository-changes";

export const repositoryChangesFeature = Effect.gen(function* () {
  const changes = createRepositoryChangesService(
    yield* RepositoryAccess,
    yield* GitCommands,
    yield* RepositoryCoordination,
  );
  const api = RepositoryChangesHttpApi;
  return {
    capabilities: [],
    httpRoutes: [
      httpRoute(api.read, (scope) => changes.read(scope), { failureStatus }),
      httpRoute(api.diff, (command) => changes.diff(command), {
        failureStatus,
      }),
      httpRoute(api.mutate, (command) => changes.mutate(command), {
        failureStatus,
      }),
      httpRoute(api.commit, (command) => changes.commit(command), {
        failureStatus,
      }),
    ],
  } satisfies EnvironmentFeature;
});

function failureStatus(error: RepositoryChangesError) {
  return error.failure.reason === "Missing" ? 404 : 409;
}
