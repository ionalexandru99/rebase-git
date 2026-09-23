import type { ChangesFailure } from "@rebase/contracts";
import { Effect } from "effect";
import type {
  GitCommand,
  GitCommandRunner,
} from "#server/domain/git-command.contract";
import { RepositoryChangesError } from "#server/domain/repository-changes.contract";
import { runRepositoryGit } from "#server/repository/access/index";

export function changesError(reason: ChangesFailure["reason"], detail: string) {
  return new RepositoryChangesError({
    failure: { _tag: "ChangesFailed", reason, detail: detail.slice(0, 2048) },
  });
}
export function changeGit(
  git: GitCommandRunner,
  directory: string,
  args: readonly string[],
  options: Partial<GitCommand> = {},
) {
  return runRepositoryGit(git, directory, args, options).pipe(
    Effect.mapError((error) => changesError("GitFailed", error.detail)),
  );
}
export function changeIo<T>(operation: () => Promise<T>) {
  return Effect.tryPromise({
    try: operation,
    catch: (error) =>
      changesError(
        "GitFailed",
        error instanceof Error
          ? error.message
          : "The filesystem operation failed.",
      ),
  });
}
