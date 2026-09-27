import { RepositoryConflictsHttpApi } from "@rebase/contracts";
import type { EnvironmentFeature } from "#server/adapters/environment-transport/combine-environment-features";
import {
  type RepositoryDependencies,
  repositoryRoutes,
} from "#server/adapters/environment-transport/http/repository-http-routes";
import { readConflictDocument } from "#server/features/repository-conflicts/git/read-conflict-document";
import { readConflictList } from "#server/features/repository-conflicts/git/read-conflict-list";
import {
  chooseWholeFile,
  stageConflict,
  writeConflict,
} from "#server/features/repository-conflicts/git/resolve-conflict";
import type { RepositoryWritePolicy } from "#server/repository/repository-coordination";

const resolve: RepositoryWritePolicy = {
  name: "resolve",
  locks: { worktree: "wait" },
  duringOperation: {
    allowWhen: (operation) =>
      operation.phase === "conflicts" || operation.phase === "ready",
  },
};

export function repositoryConflictsFeature(
  dependencies: RepositoryDependencies,
): EnvironmentFeature {
  const { command, query } = repositoryRoutes(dependencies);
  const { coordination } = dependencies;
  const api = RepositoryConflictsHttpApi;
  return {
    capabilities: [],
    httpRoutes: [
      query(api.list, (input, git) =>
        readConflictList(git, coordination, input.worktreePath),
      ),
      query(api.document, (input, git) => readConflictDocument(git, input)),
      command(api.write, resolve, (input, git) => writeConflict(git, input)),
      command(api.choose, resolve, (input, git) =>
        chooseWholeFile(git, coordination, input),
      ),
      command(api.stage, resolve, (input, git) =>
        stageConflict(git, coordination, input),
      ),
    ],
  };
}
