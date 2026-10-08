import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { Effect } from "effect";
import {
  type GitCommandOptions,
  type GitCommandRunner,
  type GitFailed,
  readGitCommonDirectory,
  runRepositoryGit,
} from "#server/adapters/local-git/git-commands.ts";
import {
  diffByteLimit,
  readBlobs,
  unreadableBlob,
} from "#server/repository/comparison/read-blobs.ts";

export interface RepositoryFileContent {
  readonly content: Buffer | null;
  readonly bytes: number;
  readonly mode: string;
  readonly identity: string;
  readonly largeFile?: "local" | "missing";
  readonly largeFileCommit?: string;
}

const pointerPattern =
  /^version https:\/\/git-lfs\.github\.com\/spec\/v1\noid sha256:([0-9a-f]{64})\nsize (\d+)\n/;

export function resolveLargeFile(
  git: GitCommandRunner,
  directory: string,
  file: RepositoryFileContent,
  commit?: string,
): Effect.Effect<RepositoryFileContent, GitFailed> {
  const pointer =
    file.content !== null && file.content.length < 1_024
      ? pointerPattern.exec(file.content.toString("utf8"))
      : null;
  const oid = pointer?.[1];
  if (oid === undefined) return Effect.succeed(file);
  const bytes = Number(pointer?.[2]);
  return readGitCommonDirectory(git, directory).pipe(
    Effect.flatMap((common) =>
      Effect.promise(() =>
        readLocalObject(
          join(common, "lfs", "objects", oid.slice(0, 2), oid.slice(2, 4), oid),
        ),
      ),
    ),
    Effect.map(
      (local): RepositoryFileContent =>
        local === undefined
          ? {
              ...file,
              bytes,
              content: null,
              largeFile: "missing",
              ...(commit === undefined ? {} : { largeFileCommit: commit }),
            }
          : { ...file, ...local, largeFile: "local" },
    ),
  );
}

async function readLocalObject(path: string) {
  const info = await stat(path).catch(() => undefined);
  if (info === undefined) return undefined;
  return {
    bytes: info.size,
    content: info.size > diffByteLimit ? null : await readFile(path),
  };
}

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
    const blob = (yield* readBlobs(
      git,
      directory,
      [oid],
      diffByteLimit,
      options,
    )).get(oid);
    if (blob === undefined) return yield* unreadableBlob;
    return yield* resolveLargeFile(git, directory, {
      ...blob,
      mode,
      identity: oid,
    });
  });
}
