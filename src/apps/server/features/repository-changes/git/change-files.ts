import { lstat, readFile, readlink, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { Effect } from "effect";
import type { GitCommandRunner } from "#server/domain/git-command.contract";
import {
  changeGit,
  changeIo,
  changesError,
} from "#server/features/repository-changes/git/change-git";

export const previewByteLimit = 160_000;
export interface ChangeFileContent {
  readonly content: Buffer | null;
  readonly bytes: number;
  readonly mode: string;
  readonly identity: string;
}

export function safeChangePath(directory: string, path: string) {
  return changeIo(async () => {
    if (
      isAbsolute(path) ||
      path.includes("\0") ||
      path
        .split(/[\\/]/)
        .some((part) => part === ".." || part.toLowerCase() === ".git")
    )
      throw new Error("Invalid changed-file path.");
    const target = resolve(directory, path);
    const root = await realpath(directory);
    let parent = dirname(target);
    while (true) {
      try {
        parent = await realpath(parent);
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        const next = dirname(parent);
        if (next === parent) throw error;
        parent = next;
      }
    }
    const inside = relative(root, parent);
    if (isAbsolute(inside) || inside === ".." || inside.startsWith(`..${sep}`))
      throw new Error("The file is outside this worktree.");
    return target;
  });
}

export function worktreeFile(directory: string, path: string) {
  return Effect.gen(function* () {
    const target = yield* safeChangePath(directory, path);
    return yield* changeIo(async (): Promise<ChangeFileContent> => {
      const info = await lstat(target).catch((error) => {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
      });
      if (info === null)
        return { content: null, bytes: 0, mode: "0", identity: "missing" };
      const mode = info.isSymbolicLink()
        ? "120000"
        : info.isDirectory()
          ? "160000"
          : info.mode & 0o111
            ? "100755"
            : "100644";
      const content =
        mode === "160000" || info.size > previewByteLimit
          ? null
          : mode === "120000"
            ? Buffer.from(await readlink(target))
            : await readFile(target);
      return {
        content,
        bytes: info.size,
        mode,
        identity: `${info.size}:${info.mtimeMs}:${info.ctimeMs}:${info.mode}`,
      };
    });
  });
}

export function objectFile(
  git: GitCommandRunner,
  directory: string,
  path: string,
  tree?: string,
) {
  return Effect.gen(function* () {
    const listing = yield* changeGit(
      git,
      directory,
      tree === undefined
        ? ["ls-files", "--stage", "-z", "--", path]
        : ["ls-tree", "-z", tree, "--", path],
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
      } satisfies ChangeFileContent;
    const fields = entry.slice(0, entry.indexOf("\t")).split(" ");
    const mode = fields[0] ?? "0";
    const oid = fields[tree === undefined ? 1 : 2];
    if (oid === undefined)
      return yield* Effect.fail(
        changesError("GitFailed", "Could not read the file object."),
      );
    if (tree === undefined && fields[2] !== "0")
      return {
        content: null,
        bytes: 0,
        mode: "conflict",
        identity: listing,
      } satisfies ChangeFileContent;
    if (mode === "160000")
      return {
        content: null,
        bytes: 0,
        mode,
        identity: oid,
      } satisfies ChangeFileContent;
    const bytes = Number(
      (yield* changeGit(git, directory, ["cat-file", "-s", oid])).trim(),
    );
    const content =
      bytes > previewByteLimit
        ? null
        : Buffer.from(
            yield* changeGit(git, directory, ["cat-file", "blob", oid], {
              outputEncoding: "base64",
            }),
            "base64",
          );
    return { content, bytes, mode, identity: oid } satisfies ChangeFileContent;
  });
}

export function worktreeIdentities(
  directory: string,
  paths: readonly string[],
) {
  return Effect.all(
    paths.map((path) =>
      changeIo(async () => {
        const info = await lstat(join(directory, path)).catch(() => null);
        return `${path}:${info?.size}:${info?.mtimeMs}:${info?.ctimeMs}:${info?.mode}`;
      }),
    ),
    { concurrency: 16 },
  );
}
