import { Effect } from "effect";
import type { RepositoryHistoryFailure } from "#contracts/repository-history/repository-history.contract.ts";
import {
  type GitCommandRunner,
  type GitObjectFormat,
  readGitEntryIdentity,
  runRepositoryGit,
} from "#server/adapters/local-git/git-commands.ts";
import { historyFailed } from "#server/features/repository-history/git/history-failures.ts";

export type ObjectFormatRead = Effect.Effect<
  GitObjectFormat,
  RepositoryHistoryFailure
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
