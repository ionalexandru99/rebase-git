import { RepositoryChangesHttpApi } from "@rebase/contracts";
import { Effect } from "effect";
import type { EnvironmentFeature } from "#server/adapters/environment-transport/environment-feature.contract";
import {
  command,
  query,
} from "#server/adapters/environment-transport/http/repository-http-routes";
import {
  commitRepositoryChanges,
  mutateRepositoryChanges,
  readRepositoryChangeDiff,
  readRepositoryChanges,
} from "#server/features/repository-changes/repository-changes";

export const repositoryChangesFeature = Effect.gen(function* () {
  const api = RepositoryChangesHttpApi;
  return {
    capabilities: [],
    httpRoutes: [
      yield* query(api.read, readRepositoryChanges),
      yield* query(api.diff, readRepositoryChangeDiff),
      yield* command(
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
      yield* command(
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
  } satisfies EnvironmentFeature;
});
