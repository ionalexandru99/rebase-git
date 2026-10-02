import { lstat, rm } from "node:fs/promises";
import { join } from "node:path";
import { Effect } from "effect";
import type {
  PreviewRestore,
  RestoreFiles,
  RestoreOverwrites,
} from "#contracts/commit-inspection/commit-inspection.contract.ts";
import { changesFailed } from "#contracts/repository-changes/repository-changes.contract.ts";
import {
  type GitCommandRunner,
  runRepositoryGit,
} from "#server/adapters/local-git/git-commands.ts";
import { changeIo } from "#server/features/repository-changes/git/change-failures.ts";
import {
  safeChangePath,
  worktreeIdentities,
} from "#server/features/repository-changes/git/change-files.ts";
import { readWorktreeFile } from "#server/features/repository-changes/git/read-change-diff.ts";
import { readRefTarget } from "#server/features/repository-refs/git/ref-git.ts";
import { buildChangeDiff } from "#server/repository/comparison/build-change-diff.ts";
import { fingerprint } from "#server/repository/comparison/fingerprint.ts";
import { objectFile } from "#server/repository/comparison/read-object-file.ts";

const listedOverwrites = 20;
const argumentCharacters = 24_000;

export function previewRestore(git: GitCommandRunner, command: PreviewRestore) {
  return Effect.gen(function* () {
    yield* safeChangePath(command.worktreePath, command.path);
    const source = yield* restoreSource(git, command);
    const [current, restored] = yield* Effect.all(
      [
        readWorktreeFile(git, command.worktreePath, command.path),
        objectFile(git, command.worktreePath, command.path, { tree: source }),
      ],
      { concurrency: 2 },
    );
    return buildChangeDiff(command.path, source, current, restored);
  });
}

export function restoreFiles(git: GitCommandRunner, command: RestoreFiles) {
  const directory = command.worktreePath;
  const paths = [...new Set(command.paths)];
  return Effect.gen(function* () {
    const targets = yield* Effect.forEach(paths, (path) =>
      safeChangePath(directory, path),
    );
    const source = yield* restoreSource(git, command);
    yield* requireOverwriteConfirmed(git, directory, paths, command.overwrite);
    const present = yield* sourcePaths(git, directory, source, paths);
    const removed = targets.filter(
      (_, index) => !present.has(paths[index] ?? ""),
    );
    const folders = yield* changeIo(() =>
      Promise.all(removed.map((target) => isFolder(target))),
    );
    const folder = removed.find((_, index) => folders[index]);
    if (folder !== undefined)
      return yield* Effect.fail(
        changesFailed(
          "Unsupported",
          `${folder} is a folder in the working tree. Move it before restoring.`,
        ),
      );
    yield* Effect.uninterruptible(
      Effect.gen(function* () {
        yield* changeIo(() => Promise.all(removed.map(removeFile)));
        const restored = paths.filter((path) => present.has(path));
        if (restored.length === 0) return;
        yield* runRepositoryGit(
          git,
          directory,
          [
            "restore",
            `--source=${source}`,
            "--worktree",
            "--pathspec-from-file=-",
            "--pathspec-file-nul",
          ],
          { input: `${restored.join("\0")}\0`, timeoutMilliseconds: 120_000 },
        );
      }),
    );
  });
}

function restoreSource(
  git: GitCommandRunner,
  command: Pick<RestoreFiles, "worktreePath" | "oid" | "parentOid" | "source">,
) {
  return Effect.gen(function* () {
    const revision =
      command.source === "commit"
        ? command.oid
        : (command.parentOid ?? `${command.oid}^1`);
    const source = yield* readRefTarget(
      git,
      command.worktreePath,
      `${revision}^{commit}`,
    );
    if (source !== undefined) return source;
    return yield* Effect.fail(
      command.source === "parent"
        ? changesFailed("Unsupported", "This commit has no parent.")
        : changesFailed("Stale", "That commit no longer exists."),
    );
  });
}

function requireOverwriteConfirmed(
  git: GitCommandRunner,
  directory: string,
  paths: readonly string[],
  overwrite: string | undefined,
) {
  return Effect.gen(function* () {
    const checked = [
      ...paths,
      ...(yield* changeIo(() => blockingAncestors(directory, paths))),
    ];
    const read = (args: readonly string[]) =>
      Effect.forEach(chunks(checked), (chunk) =>
        runRepositoryGit(
          git,
          directory,
          [...args, "--", ...chunk.map((path) => `:(literal,icase)${path}`)],
          {
            literalPathspecs: false,
            globalArguments: ["--no-optional-locks"],
            maxOutputBytes: 16 * 1_048_576,
          },
        ),
      ).pipe(
        Effect.map((outputs) =>
          outputs.flatMap((output) => output.split("\0")),
        ),
      );
    const [statuses, entries] = yield* Effect.all([
      read([
        "status",
        "--porcelain=v1",
        "-z",
        "--untracked-files=all",
        "--ignored=matching",
        "--no-renames",
      ]),
      read(["ls-files", "-v", "-z"]),
    ]);
    const hidden = entries
      .filter((entry) => entry.length > 2 && hidesEdits(entry))
      .map((entry) => entry.slice(2));
    const existing = yield* changeIo(() =>
      Promise.all(hidden.map((path) => exists(join(directory, path)))),
    );
    const edited = [
      ...new Set([
        ...statuses
          .filter((record) => record.length > 3 && hasLocalEdits(record))
          .map((record) => record.slice(3)),
        ...hidden.filter((_, index) => existing[index]),
      ]),
    ].sort();
    if (edited.length === 0) return;
    const identities = yield* worktreeIdentities(directory, edited);
    const confirmed = fingerprint(...identities);
    if (overwrite === confirmed) return;
    return yield* Effect.fail<RestoreOverwrites>({
      _tag: "RestoreOverwrites",
      paths: edited.slice(0, listedOverwrites),
      count: edited.length,
      fingerprint: confirmed,
    });
  });
}

function hasLocalEdits(record: string) {
  const state = record.slice(0, 2);
  return (
    state.includes("U") ||
    state === "AA" ||
    state === "DD" ||
    (state[1] !== " " && state[1] !== "D")
  );
}

function hidesEdits(entry: string) {
  const tag = entry[0] ?? "";
  return tag === "S" || tag !== tag.toUpperCase();
}

async function blockingAncestors(directory: string, paths: readonly string[]) {
  const ancestors = new Set(
    paths.flatMap((path) =>
      path
        .split("/")
        .slice(0, -1)
        .map((_, index, parts) => parts.slice(0, index + 1).join("/")),
    ),
  );
  const blocking = await Promise.all(
    [...ancestors].map(async (ancestor) => {
      const info = await lstat(join(directory, ancestor)).catch(() => null);
      return info !== null && !info.isDirectory() ? [ancestor] : [];
    }),
  );
  return blocking.flat();
}

function exists(target: string) {
  return lstat(target).then(
    () => true,
    () => false,
  );
}

function isFolder(target: string) {
  return lstat(target).then(
    (info) => info.isDirectory(),
    () => false,
  );
}

async function removeFile(target: string) {
  await rm(target, { force: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOTDIR") throw error;
  });
}

function sourcePaths(
  git: GitCommandRunner,
  directory: string,
  source: string,
  paths: readonly string[],
) {
  return Effect.forEach(chunks(paths), (chunk) =>
    runRepositoryGit(git, directory, [
      "ls-tree",
      "-z",
      "--name-only",
      source,
      "--",
      ...chunk,
    ]),
  ).pipe(
    Effect.map(
      (outputs) => new Set(outputs.flatMap((output) => output.split("\0"))),
    ),
  );
}

function chunks(paths: readonly string[]) {
  const groups: string[][] = [];
  let length = argumentCharacters;
  for (const path of paths) {
    if (length + path.length > argumentCharacters) {
      groups.push([]);
      length = 0;
    }
    groups.at(-1)?.push(path);
    length += path.length + 1;
  }
  return groups;
}
