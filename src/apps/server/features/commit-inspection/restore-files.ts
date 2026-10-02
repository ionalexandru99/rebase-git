import { rm } from "node:fs/promises";
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
    yield* Effect.uninterruptible(
      Effect.gen(function* () {
        yield* changeIo(() =>
          Promise.all(
            targets
              .filter((_, index) => !present.has(paths[index] ?? ""))
              .map((target) => rm(target, { force: true })),
          ),
        );
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
    const edited = (yield* Effect.forEach(chunks(paths), (chunk) =>
      runRepositoryGit(
        git,
        directory,
        [
          "status",
          "--porcelain=v1",
          "-z",
          "--untracked-files=all",
          "--ignored=matching",
          "--no-renames",
          "--",
          ...chunk,
        ],
        {
          globalArguments: ["--no-optional-locks"],
          maxOutputBytes: 16 * 1_048_576,
        },
      ),
    ))
      .flatMap((output) => output.split("\0"))
      .filter((record) => record.length > 3 && hasLocalEdits(record))
      .map((record) => record.slice(3))
      .sort();
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
  const worktree = record[1];
  return worktree !== " " && worktree !== "D";
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
