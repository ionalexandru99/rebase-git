import { Effect } from "effect";
import type { GitCommandRunner } from "#server/domain/git-command.contract";
import type {
  RepositoryWatcher,
  RepositoryWatchHandle,
} from "#server/domain/repository-watcher.contract";
import { readGitCommonDirectory } from "#server/repository/access/git/read-git-common-directory";
import {
  canonicalizeWorktrees,
  readWorktrees,
} from "#server/repository/access/git/read-worktrees";

interface WorktreePaths {
  paths?: ReadonlySet<string>;
  watch?: RepositoryWatchHandle | undefined;
}

export function createWorktreePathCache(
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
      entry.watch = yield* watcher.watch(directory, () => {
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
