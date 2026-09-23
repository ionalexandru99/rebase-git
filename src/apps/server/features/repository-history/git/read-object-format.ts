import { Effect } from "effect";
import type { GitCommandRunner } from "#server/domain/git-command.contract";
import type { GitObjectFormat } from "#server/domain/git-object-id";
import { historyFailed } from "#server/features/repository-history/git/history-failures";
import { runRepositoryGit } from "#server/repository/access/index";

export function readObjectFormat(
  git: GitCommandRunner,
  repositoryPath: string,
) {
  return runRepositoryGit(git, repositoryPath, [
    "rev-parse",
    "--show-object-format",
  ]).pipe(
    Effect.flatMap((output) => {
      const format = output.trim();
      return format === "sha1" || format === "sha256"
        ? Effect.succeed<GitObjectFormat>(format)
        : Effect.fail(
            historyFailed(`Unsupported Git object format: ${format}`),
          );
    }),
  );
}
