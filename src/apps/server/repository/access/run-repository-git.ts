import { Effect } from "effect";
import type {
  GitCommand,
  GitCommandRunner,
} from "#server/domain/git-command.contract";
import { RepositoryGitError } from "#server/domain/repository-git.contract";

export function runRepositoryGit(
  git: GitCommandRunner,
  directory: string,
  args: readonly string[],
  options: Partial<GitCommand> = {},
) {
  return git
    .run({ ...options, directory, arguments: ["--literal-pathspecs", ...args] })
    .pipe(
      Effect.mapError(
        (error) =>
          new RepositoryGitError({
            cause: error,
            detail: `Git could not complete the operation (${error.reason}).`,
            reason: error.reason,
          }),
      ),
      Effect.flatMap((output) =>
        output.exitCode === 0
          ? Effect.succeed(output.stdout)
          : Effect.fail(
              new RepositoryGitError({
                detail: output.stderr || "Git rejected the operation.",
                reason: "Failed",
              }),
            ),
      ),
    );
}
