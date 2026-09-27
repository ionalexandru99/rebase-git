import { CommitInspectionHttpApi } from "@rebase/contracts";
import type { EnvironmentFeature } from "#server/adapters/environment-transport/combine-environment-features";
import {
  type RepositoryDependencies,
  repositoryRoutes,
} from "#server/adapters/environment-transport/http/repository-http-routes";
import {
  inspectCommit,
  inspectCommitDiff,
} from "#server/features/commit-inspection/git/inspect-commit";

export function commitInspectionFeature(
  dependencies: RepositoryDependencies,
): EnvironmentFeature {
  const { query } = repositoryRoutes(dependencies);
  const api = CommitInspectionHttpApi;
  return {
    capabilities: [],
    httpRoutes: [
      query(api.inspect, (input, git) => inspectCommit(git, input)),
      query(api.inspectDiff, (input, git) => inspectCommitDiff(git, input)),
    ],
  };
}
