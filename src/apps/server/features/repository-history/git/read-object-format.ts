import { Effect } from "effect";
import type { GitCommandRunner } from "#server/domain/git-command.contract";
import type { GitObjectFormat } from "#server/domain/git-object-id";
import type { RepositoryGitError } from "#server/domain/repository-git.contract";
import {
  historyFailed,
  type RepositoryHistoryError,
} from "#server/features/repository-history/git/history-failures";
import {
  readGitEntryIdentity,
  runRepositoryGit,
} from "#server/repository/access/index";

export type ObjectFormatRead = Effect.Effect<
  GitObjectFormat,
  RepositoryHistoryError | RepositoryGitError
>;

export function createObjectFormatCache(git: GitCommandRunner) {
  const formats = new Map<
    string,
    { readonly identity: string; readonly format: GitObjectFormat }
  >();
  return (repositoryPath: string): ObjectFormatRead =>
    Effect.gen(function* () {
      const identity = yield* readGitEntryIdentity(repositoryPath);
      const known = formats.get(repositoryPath);
      if (identity !== undefined && known?.identity === identity)
        return known.format;
      const format = yield* readObjectFormat(git, repositoryPath);
      if (identity !== undefined)
        formats.set(repositoryPath, { identity, format });
      return format;
    });
}

export function readObjectFormat(
  git: GitCommandRunner,
  repositoryPath: string,
): ObjectFormatRead {
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
