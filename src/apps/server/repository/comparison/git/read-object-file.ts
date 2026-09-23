import { Effect } from "effect";
import type {
  GitCommandOptions,
  GitCommandRunner,
} from "#server/domain/git-command.contract";
import {
  previewByteLimit,
  type RepositoryFileContent,
} from "#server/domain/repository-comparison.contract";
import { RepositoryGitError } from "#server/domain/repository-git.contract";
import { runRepositoryGit } from "#server/repository/access/index";

export function objectFile(
  git: GitCommandRunner,
  directory: string,
  path: string,
  { tree, ...options }: GitCommandOptions & { readonly tree?: string } = {},
) {
  return Effect.gen(function* () {
    const listing = yield* runRepositoryGit(
      git,
      directory,
      tree === undefined
        ? ["ls-files", "--stage", "-z", "--", path]
        : ["ls-tree", "-z", tree, "--", path],
      options,
    );
    const records = listing.split("\0").filter(Boolean);
    const entry = records.find(
      (record) => record.slice(record.indexOf("\t") + 1) === path,
    );
    if (entry === undefined)
      return {
        content: null,
        bytes: 0,
        mode: "0",
        identity: "missing",
      } satisfies RepositoryFileContent;
    const fields = entry.slice(0, entry.indexOf("\t")).split(" ");
    const mode = fields[0] ?? "0";
    const oid = fields[tree === undefined ? 1 : 2];
    if (oid === undefined)
      return yield* Effect.fail(
        new RepositoryGitError({
          detail: "Could not read the file object.",
          reason: "Failed",
        }),
      );
    if (tree === undefined && fields[2] !== "0")
      return {
        content: null,
        bytes: 0,
        mode: "conflict",
        identity: listing,
      } satisfies RepositoryFileContent;
    if (mode === "160000")
      return {
        content: null,
        bytes: 0,
        mode,
        identity: oid,
      } satisfies RepositoryFileContent;
    const bytes = Number(
      (yield* runRepositoryGit(
        git,
        directory,
        ["cat-file", "-s", oid],
        options,
      )).trim(),
    );
    const content =
      bytes > previewByteLimit
        ? null
        : Buffer.from(
            yield* runRepositoryGit(git, directory, ["cat-file", "blob", oid], {
              ...options,
              outputEncoding: "base64",
            }),
            "base64",
          );
    return {
      content,
      bytes,
      mode,
      identity: oid,
    } satisfies RepositoryFileContent;
  });
}
