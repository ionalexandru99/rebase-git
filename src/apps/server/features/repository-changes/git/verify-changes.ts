import { type ChangesScope, changesFailed } from "@rebase/contracts";
import { Effect } from "effect";
import type { GitCommandRunner } from "#server/domain/git-command.contract";
import { worktreeIdentities } from "#server/features/repository-changes/git/change-files";
import { readChanges } from "#server/features/repository-changes/git/read-changes";

export function verifyChanges(
  git: GitCommandRunner,
  scope: ChangesScope & { readonly revision: string },
) {
  return readChanges(git, scope).pipe(
    Effect.flatMap((current) =>
      current.snapshot.revision === scope.revision
        ? Effect.succeed(current)
        : Effect.fail(staleChanges()),
    ),
  );
}

export function verifyChangedFiles(
  directory: string,
  files: {
    readonly paths: readonly string[];
    readonly identities: readonly string[];
  },
) {
  return worktreeIdentities(directory, files.paths).pipe(
    Effect.flatMap((identities) =>
      identities.every(
        (identity, index) => identity === files.identities[index],
      )
        ? Effect.void
        : Effect.fail(staleChanges()),
    ),
  );
}

function staleChanges() {
  return changesFailed(
    "Stale",
    "The repository changed. Review the refreshed changes and try again.",
  );
}
