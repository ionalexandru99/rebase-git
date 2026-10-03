import { realpath } from "node:fs";
import { lstat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { Effect } from "effect";
import {
  type RepositoryRejected,
  repositoryRejected,
} from "#contracts/git/git-failures.contract.ts";
import type { RepositoryCatalogEntry } from "#contracts/repository-catalog/repository-catalog.contract.ts";
import type { RepositoryWorktree } from "#contracts/repository-refs/repository-refs.contract.ts";
import {
  cacheByGitEntry,
  type GitCommandRunner,
  isGitRejection,
  runRepositoryGit,
} from "#server/adapters/local-git/git-commands.ts";
import type { EnvironmentStorageError } from "#server/persistence/sqlite/storage-operation.ts";

const realpathNative = promisify(realpath.native);
const branchPrefix = "refs/heads/";

export interface RepositoryAccess {
  readonly repository: (
    repositoryId: string,
  ) => Effect.Effect<
    RepositoryCatalogEntry,
    RepositoryRejected | EnvironmentStorageError
  >;
  readonly worktrees: (
    repositoryPath: string,
  ) => Effect.Effect<readonly RepositoryWorktree[], RepositoryRejected>;
  readonly requireWorktree: (scope: {
    readonly repositoryId: string;
    readonly worktreePath: string;
  }) => Effect.Effect<void, RepositoryRejected | EnvironmentStorageError>;
}

export function createRepositoryAccess(
  catalog: {
    readonly find: (
      repositoryId: string,
    ) => Effect.Effect<
      RepositoryCatalogEntry | undefined,
      EnvironmentStorageError
    >;
  },
  git: GitCommandRunner,
): RepositoryAccess {
  const locations = cacheByGitEntry((directory) =>
    readWorktreeLocation(git, directory),
  );
  const repository = (repositoryId: string) =>
    catalog
      .find(repositoryId)
      .pipe(
        Effect.flatMap((entry) =>
          entry === undefined
            ? Effect.fail(
                repositoryRejected(
                  "Missing",
                  "This repository is no longer available.",
                ),
              )
            : Effect.succeed(entry),
        ),
      );
  return {
    repository,
    worktrees: (repositoryPath) =>
      readWorktrees(git, repositoryPath).pipe(
        Effect.flatMap(canonicalizeWorktrees),
        Effect.mapError(worktreesUnreadable),
      ),
    requireWorktree: (scope) =>
      Effect.gen(function* () {
        const entry = yield* repository(scope.repositoryId);
        const owner = yield* locations
          .read(entry.path)
          .pipe(Effect.mapError(worktreesUnreadable));
        const worktree = yield* locations
          .read(scope.worktreePath)
          .pipe(
            Effect.catch((failure) =>
              !isGitRejection(failure)
                ? Effect.fail(worktreesUnreadable())
                : hasGitEntry(scope.worktreePath).pipe(
                    Effect.flatMap((present) =>
                      present
                        ? Effect.fail(
                            repositoryRejected("GitFailed", failure.detail),
                          )
                        : Effect.succeed(undefined),
                    ),
                  ),
            ),
          );
        if (
          worktree?.root !== scope.worktreePath ||
          worktree.commonDirectory !== owner.commonDirectory
        )
          return yield* Effect.fail(
            repositoryRejected(
              "Missing",
              "This worktree does not belong to the repository.",
            ),
          );
      }),
  };
}

function readWorktreeLocation(git: GitCommandRunner, directory: string) {
  return runRepositoryGit(git, directory, [
    "rev-parse",
    "--path-format=absolute",
    "--show-toplevel",
    "--git-common-dir",
  ]).pipe(
    Effect.flatMap((output) => {
      const [root = "", commonDirectory = ""] = output.trimEnd().split("\n");
      return Effect.all({
        root: canonicalizePath(root),
        commonDirectory: canonicalizePath(commonDirectory),
      });
    }),
  );
}

function hasGitEntry(directory: string) {
  return Effect.promise(() =>
    lstat(join(directory, ".git")).then(
      () => true,
      () => false,
    ),
  );
}

function canonicalizePath(path: string) {
  return Effect.promise(() => realpathNative(path).catch(() => resolve(path)));
}

export function readWorktrees(git: GitCommandRunner, directory: string) {
  return runRepositoryGit(
    git,
    directory,
    ["worktree", "list", "--porcelain", "-z"],
    { timeoutMilliseconds: 15_000 },
  ).pipe(Effect.map(parseWorktreeList));
}

export function canonicalizeWorktrees(
  worktrees: readonly RepositoryWorktree[],
) {
  return Effect.all(
    worktrees.map((worktree) =>
      Effect.promise(() =>
        realpathNative(worktree.path).then(
          (path) => ({ ...worktree, path }),
          (error: NodeJS.ErrnoException) => ({
            ...worktree,
            path: resolve(worktree.path),
            ...(error.code === "ENOENT" ? { missing: true } : {}),
          }),
        ),
      ),
    ),
    { concurrency: "unbounded" },
  );
}

export function parseWorktreeList(
  stdout: string,
): readonly RepositoryWorktree[] {
  return splitWorktreeEntries(stdout).flatMap((entry, index) => {
    const worktree = worktreeFromEntry(entry, index === 0);
    return worktree === undefined ? [] : [worktree];
  });
}

function worktreesUnreadable() {
  return repositoryRejected(
    "GitFailed",
    "Could not read the repository worktrees.",
  );
}

function splitWorktreeEntries(stdout: string): readonly (readonly string[])[] {
  const entries: string[][] = [];
  let current: string[] = [];
  for (const line of stdout.split("\0")) {
    if (line.length === 0) {
      if (current.length > 0) entries.push(current);
      current = [];
      continue;
    }
    current.push(line);
  }
  if (current.length > 0) entries.push(current);
  return entries;
}

function worktreeFromEntry(
  entry: readonly string[],
  main: boolean,
): RepositoryWorktree | undefined {
  const fields = new Map(
    entry.map((line) => {
      const separator = line.indexOf(" ");
      return separator < 0
        ? [line, ""]
        : [line.slice(0, separator), line.slice(separator + 1)];
    }),
  );
  const path = fields.get("worktree");
  const commit = fields.get("HEAD");
  if (path === undefined || commit === undefined || fields.has("bare")) {
    return undefined;
  }
  const branch = fields.get("branch");
  const locked = fields.get("locked");
  return {
    head: {
      ...(branch?.startsWith(branchPrefix)
        ? { branch: branch.slice(branchPrefix.length) }
        : {}),
      commit,
    },
    main,
    path,
    ...(locked === undefined ? {} : { locked: locked.slice(0, 1_024) }),
    ...(fields.has("prunable") ? { missing: true } : {}),
  };
}
