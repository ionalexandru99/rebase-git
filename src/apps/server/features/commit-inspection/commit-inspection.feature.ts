import { CommitInspectionApi } from "@rebase/contracts";
import type { EnvironmentFeature } from "#server/adapters/environment-transport/environment-routes";
import {
  type RepositoryDependencies,
  repositoryRoutes,
} from "#server/adapters/environment-transport/environment-routes";
import {
  inspectCommit,
  inspectCommitDiff,
} from "#server/features/commit-inspection/git/inspect-commit";

export function commitInspectionFeature(
  dependencies: RepositoryDependencies,
): EnvironmentFeature {
  const { query } = repositoryRoutes(dependencies);
  const api = CommitInspectionApi;
  return {
    routes: [
      query(api.inspect, (input, git) => inspectCommit(git, input)),
      query(api.inspectDiff, (input, git) => inspectCommitDiff(git, input)),
    ],
  };
}
