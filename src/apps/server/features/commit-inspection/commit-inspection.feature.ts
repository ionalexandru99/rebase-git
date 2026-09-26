import { CommitInspectionHttpApi } from "@rebase/contracts";
import { Effect } from "effect";
import type { EnvironmentFeature } from "#server/adapters/environment-transport/environment-feature.contract";
import { query } from "#server/adapters/environment-transport/http/repository-http-routes";
import {
  inspectCommit,
  inspectCommitDiff,
} from "#server/features/commit-inspection/git/inspect-commit";

export const commitInspectionFeature = Effect.gen(function* () {
  const api = CommitInspectionHttpApi;
  return {
    capabilities: [],
    httpRoutes: [
      yield* query(api.inspect, (input, git) => inspectCommit(git, input)),
      yield* query(api.inspectDiff, (input, git) =>
        inspectCommitDiff(git, input),
      ),
    ],
  } satisfies EnvironmentFeature;
});
