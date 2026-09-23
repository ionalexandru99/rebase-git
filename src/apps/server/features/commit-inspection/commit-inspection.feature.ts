import { CommitInspectionHttpApi } from "@rebase/contracts";
import { Effect } from "effect";
import type { EnvironmentFeature } from "#server/adapters/environment-transport/environment-feature.contract";
import { httpRoute } from "#server/adapters/environment-transport/http/environment-http-route-handler";
import { GitCommands } from "#server/domain/git-command.contract";
import { RepositoryAccess } from "#server/domain/repository-access.contract";
import { createCommitInspectionService } from "#server/features/commit-inspection/commit-inspection";
import type { CommitInspectionError } from "#server/features/commit-inspection/git/inspection-error";

export const commitInspectionFeature = Effect.gen(function* () {
  const inspection = createCommitInspectionService(
    yield* RepositoryAccess,
    yield* GitCommands,
  );
  const api = CommitInspectionHttpApi;
  return {
    capabilities: [],
    httpRoutes: [
      httpRoute(api.inspect, (command) => inspection.inspect(command), {
        failureStatus,
      }),
      httpRoute(api.inspectDiff, (command) => inspection.inspectDiff(command), {
        failureStatus,
      }),
    ],
  } satisfies EnvironmentFeature;
});

function failureStatus(error: CommitInspectionError) {
  return error.failure.reason === "Missing" ? 404 : 409;
}
