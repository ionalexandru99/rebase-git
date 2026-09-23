import type { ChangesScope } from "@rebase/contracts";
import { Effect } from "effect";
import type { GitCommandRunner } from "#server/domain/git-command.contract";
import { changesError } from "#server/features/repository-changes/git/change-git";
import { readChanges } from "#server/features/repository-changes/git/read-changes";

export function verifyChanges(
  git: GitCommandRunner,
  scope: ChangesScope & { readonly revision: string },
) {
  return readChanges(git, scope).pipe(
    Effect.flatMap((current) =>
      current.snapshot.revision === scope.revision
        ? Effect.succeed(current)
        : Effect.fail(
            changesError(
              "Stale",
              "The repository changed. Review the refreshed changes and try again.",
            ),
          ),
    ),
  );
}
