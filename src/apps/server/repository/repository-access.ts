import { realpath } from "node:fs";
import { lstat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { repositoryRejected } from "#contracts/git/git-failures.contract.ts";
import type { RepositoryCatalogEntry } from "#contracts/repository-catalog/repository-catalog.contract.ts";
import type { RepositoryWorktree } from "#contracts/repository-refs/repository-refs.contract.ts";
import {
  cacheByGitEntry,
  type GitCommandRunner,
  isGitFailed,
  isGitRejection,
  runRepositoryGit,
} from "#server/adapters/local-git/git-commands.ts";

const realpathNative = promisify(realpath.native);
const branchPrefix = "refs/heads/";

export interface RepositoryAccess {
  readonly repository: (
    repositoryId: string,
  ) => Promise<RepositoryCatalogEntry>;
  readonly worktrees: (
    repositoryPath: string,
  ) => Promise<readonly RepositoryWorktree[]>;
  readonly requireWorktree: (scope: {
    readonly repositoryId: string;
    readonly worktreePath: string;
  }) => Promise<void>;
}

export interface WorktreeLocation {
  readonly root: string;
  readonly gitDirectory: string;
  readonly commonDirectory: string;
}

export interface WorktreeLocations {
  readonly read: (directory: string) => Promise<WorktreeLocation>;
  readonly forget: (directory: string) => void;
}

export function createWorktreeLocations(
  git: GitCommandRunner,
): WorktreeLocations {
  return cacheByGitEntry((directory) => readWorktreeLocation(git, directory));
}

export function createRepositoryAccess(
  catalog: {
    readonly find: (
      repositoryId: string,
    ) => Promise<RepositoryCatalogEntry | undefined>;
  },
  git: GitCommandRunner,
  locations: WorktreeLocations,
): RepositoryAccess {
  const repository = async (repositoryId: string) => {
    const entry = await catalog.find(repositoryId);
    if (entry === undefined)
      throw repositoryRejected(
        "Missing",
        "This repository is no longer available.",
      );
    return entry;
  };
  const worktreeLocation = async (worktreePath: string) => {
    try {
      return await locations.read(worktreePath);
    } catch (failure) {
      if (!isGitFailed(failure) || !isGitRejection(failure))
        throw worktreesUnreadable();
      if (await hasGitEntry(worktreePath))
        throw repositoryRejected("GitFailed", failure.detail);
      return undefined;
    }
  };
  return {
    repository,
    worktrees: async (repositoryPath) => {
      try {
        return await readWorktrees(git, repositoryPath);
      } catch {
        throw worktreesUnreadable();
      }
    },
    requireWorktree: async (scope) => {
      const entry = await repository(scope.repositoryId);
      const owner = await locations
        .read(entry.path)
        .catch(() => Promise.reject(worktreesUnreadable()));
      const worktree = await worktreeLocation(scope.worktreePath);
      if (
        worktree?.root !== scope.worktreePath ||
        worktree.commonDirectory !== owner.commonDirectory
      )
        throw repositoryRejected(
          "Missing",
          "This worktree does not belong to the repository.",
        );
    },
  };
}

async function readWorktreeLocation(
  git: GitCommandRunner,
  directory: string,
): Promise<WorktreeLocation> {
  const output = await runRepositoryGit(git, directory, [
    "rev-parse",
    "--path-format=absolute",
    "--show-toplevel",
    "--absolute-git-dir",
    "--git-common-dir",
  ]);
  const [root = "", gitDirectory = "", commonDirectory = ""] = output
    .trimEnd()
    .split("\n");
  return {
    root: await canonicalizePath(root),
    gitDirectory: await canonicalizePath(gitDirectory),
    commonDirectory: await canonicalizePath(commonDirectory),
  };
}

function hasGitEntry(directory: string) {
  return lstat(join(directory, ".git")).then(
    () => true,
    () => false,
  );
}

export function canonicalizePath(path: string) {
  return realpathNative(path).catch(() => resolve(path));
}

export async function readWorktrees(git: GitCommandRunner, directory: string) {
  const worktrees = parseWorktreeList(
    await runRepositoryGit(
      git,
      directory,
      ["worktree", "list", "--porcelain", "-z"],
      { timeoutMilliseconds: 15_000 },
    ),
  );
  return Promise.all(
    worktrees.map((worktree) =>
      realpathNative(worktree.path).then(
        (path) => ({ ...worktree, path }),
        (error: NodeJS.ErrnoException) => ({
          ...worktree,
          path: resolve(worktree.path),
          ...(error.code === "ENOENT" ? { missing: true } : {}),
        }),
      ),
    ),
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
