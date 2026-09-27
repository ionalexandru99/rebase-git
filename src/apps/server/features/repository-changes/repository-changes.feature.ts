import { RepositoryChangesApi } from "@rebase/contracts";
import type { EnvironmentFeature } from "#server/adapters/environment-transport/environment-routes";
import {
  type RepositoryDependencies,
  repositoryRoutes,
} from "#server/adapters/environment-transport/environment-routes";
import {
  commitRepositoryChanges,
  mutateRepositoryChanges,
  readRepositoryChangeDiff,
  readRepositoryChanges,
} from "#server/features/repository-changes/repository-changes";

export function repositoryChangesFeature(
  dependencies: RepositoryDependencies,
): EnvironmentFeature {
  const { command, query } = repositoryRoutes(dependencies);
  const api = RepositoryChangesApi;
  return {
    routes: [
      query(api.read, readRepositoryChanges),
      query(api.diff, readRepositoryChangeDiff),
      command(
        api.mutate,
        (input) => ({
          name: input.action,
          locks: { worktree: "wait" },
          duringOperation:
            input.action === "discard"
              ? "block"
              : { allowWhen: (operation) => operation.kind !== "unknown" },
        }),
        mutateRepositoryChanges,
      ),
      command(
        api.commit,
        (input) =>
          input.amend
            ? {
                name: "amend",
                locks: { refs: "wait", worktree: "wait" },
                duringOperation: {
                  allowWhen: (operation) =>
                    operation.kind === "rebase" && operation.phase === "edit",
                },
              }
            : {
                name: "commit",
                locks: { refs: "wait", worktree: "wait" },
                duringOperation: "block",
              },
        commitRepositoryChanges,
      ),
    ],
  };
}
