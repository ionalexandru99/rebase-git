import { Effect } from "effect";
import type {
  GitCommandOptions,
  GitCommandRunner,
} from "#server/domain/git-command.contract";
import type { RepositoryFileContent } from "#server/domain/repository-comparison.contract";
import { runRepositoryGit } from "#server/repository/access/index";
import {
  readBlobs,
  unreadableBlob,
} from "#server/repository/comparison/git/read-blobs";

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
    if (oid === undefined) return yield* unreadableBlob;
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
    const blob = (yield* readBlobs(git, directory, [oid], options)).get(oid);
    if (blob === undefined) return yield* unreadableBlob;
    return {
      ...blob,
      mode,
      identity: oid,
    } satisfies RepositoryFileContent;
  });
}
