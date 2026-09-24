import { RepositoryOperationsHttpApi } from "@rebase/contracts";
import { Effect } from "effect";
import type { EnvironmentFeature } from "#server/adapters/environment-transport/environment-feature.contract";
import { httpRoute } from "#server/adapters/environment-transport/http/environment-http-route-handler";
import { GitCommands } from "#server/domain/git-command.contract";
import { RepositoryAccess } from "#server/domain/repository-access.contract";
import { RepositoryCoordination } from "#server/domain/repository-coordination.contract";
import type { RepositoryOperationError } from "#server/features/repository-operations/git/operation-failures";
import { createRepositoryOperationsService } from "#server/features/repository-operations/repository-operations";

export const repositoryOperationsFeature = Effect.gen(function* () {
  const operations = createRepositoryOperationsService(
    yield* RepositoryAccess,
    yield* GitCommands,
    yield* RepositoryCoordination,
  );
  const api = RepositoryOperationsHttpApi;
  return {
    capabilities: [],
    httpRoutes: [
      httpRoute(api.read, (scope) => operations.read(scope), {
        failureStatus,
      }),
      httpRoute(api.execute, (command) => operations.execute(command), {
        failureStatus,
      }),
    ],
  } satisfies EnvironmentFeature;
});

function failureStatus(error: RepositoryOperationError) {
  return error.failure.reason === "Missing" ? 404 : 409;
}
