import { Effect } from "effect";
import type {
  GitCommand,
  GitCommandRunner,
} from "#server/domain/git-command.contract";
import type { RepositoryGitError } from "#server/domain/repository-git.contract";
import { RepositoryHistoryError } from "#server/domain/repository-history.contract";
import { runRepositoryGit } from "#server/repository/access/index";

const historyTimeoutMilliseconds = 30_000;

export function historyGit(
  git: GitCommandRunner,
  directory: string,
  args: readonly string[],
  options: Partial<GitCommand> = {},
) {
  return runRepositoryGit(git, directory, args, {
    timeoutMilliseconds: historyTimeoutMilliseconds,
    ...options,
  }).pipe(Effect.mapError(historyGitFailed));
}

function historyGitFailed(error: RepositoryGitError) {
  return new RepositoryHistoryError({
    cause: error,
    failure:
      error.reason === "Failed"
        ? {
            _tag: "GitFailed",
            detail: error.detail.slice(0, 2_048),
            reason: "Failed",
          }
        : { _tag: "GitFailed", reason: error.reason },
  });
}
