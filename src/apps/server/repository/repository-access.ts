import { realpath } from "node:fs";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { Effect } from "effect";
import {
  type RepositoryRejected,
  repositoryRejected,
} from "#contracts/git/git-failures.contract.ts";
import type { RepositoryCatalogEntry } from "#contracts/repository-catalog/repository-catalog.contract.ts";
import type { RepositoryWorktree } from "#contracts/repository-refs/repository-refs.contract.ts";
import {
  type GitCommandRunner,
  readGitCommonDirectory,
  runRepositoryGit,
} from "#server/adapters/local-git/git-commands.ts";
import type {
  RepositoryWatcher,
  RepositoryWatchHandle,
} from "#server/adapters/local-git/local-repository-watcher.ts";
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
  watcher: RepositoryWatcher,
): RepositoryAccess {
  const worktreePaths = createWorktreePathCache(git, watcher);
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
        const known = yield* worktreePaths
          .contains(entry.path, scope.worktreePath)
          .pipe(Effect.mapError(worktreesUnreadable));
        if (!known)
          return yield* Effect.fail(
            repositoryRejected(
              "Missing",
              "This worktree does not belong to the repository.",
            ),
          );
      }),
  };
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

interface WorktreePaths {
  paths?: ReadonlySet<string>;
  watch?: RepositoryWatchHandle | undefined;
}

function createWorktreePathCache(
  git: GitCommandRunner,
  watcher: RepositoryWatcher,
) {
  const cache = new Map<string, WorktreePaths>();
  const forget = (repositoryPath: string, entry: WorktreePaths) => {
    if (cache.get(repositoryPath) === entry) cache.delete(repositoryPath);
    const watch = entry.watch;
    entry.watch = undefined;
    watch?.close();
  };
  const reload = (repositoryPath: string) => {
    const entry: WorktreePaths = {};
    let changed = false;
    return Effect.gen(function* () {
      const directory = yield* readGitCommonDirectory(git, repositoryPath);
      entry.watch = yield* watcher.watch(directory, (kind) => {
        if (kind === "Index") return;
        changed = true;
        forget(repositoryPath, entry);
      });
      const worktrees = yield* readWorktrees(git, repositoryPath).pipe(
        Effect.flatMap(canonicalizeWorktrees),
      );
      entry.paths = new Set(worktrees.map((worktree) => worktree.path));
      if (!changed) {
        const previous = cache.get(repositoryPath);
        if (previous !== undefined) forget(repositoryPath, previous);
        cache.set(repositoryPath, entry);
      }
      return entry.paths;
    }).pipe(
      Effect.onExit(() =>
        Effect.sync(() => {
          if (cache.get(repositoryPath) !== entry)
            forget(repositoryPath, entry);
        }),
      ),
    );
  };
  return {
    contains: (repositoryPath: string, worktreePath: string) =>
      cache.get(repositoryPath)?.paths?.has(worktreePath)
        ? Effect.succeed(true)
        : reload(repositoryPath).pipe(
            Effect.map((paths) => paths.has(worktreePath)),
          ),
  };
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
