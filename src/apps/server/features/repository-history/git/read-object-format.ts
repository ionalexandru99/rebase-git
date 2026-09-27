import type { RepositoryHistoryOperationFailure } from "@rebase/contracts";
import { Effect } from "effect";
import {
  type GitCommandRunner,
  readGitEntryIdentity,
  runRepositoryGit,
} from "#server/adapters/local-git/git-commands";
import { historyFailed } from "#server/features/repository-history/git/history-failures";

export type GitObjectFormat = "sha1" | "sha256";

export type ObjectFormatRead = Effect.Effect<
  GitObjectFormat,
  RepositoryHistoryOperationFailure
>;

const objectIdLengths: Readonly<Record<GitObjectFormat, number>> = {
  sha1: 40,
  sha256: 64,
};
const hexadecimal = /^[0-9a-f]+$/;

export function isGitObjectId(value: string, objectFormat?: GitObjectFormat) {
  const lengths =
    objectFormat === undefined
      ? Object.values(objectIdLengths)
      : [objectIdLengths[objectFormat]];
  return lengths.includes(value.length) && hexadecimal.test(value);
}

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
