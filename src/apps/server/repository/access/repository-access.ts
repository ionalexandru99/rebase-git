import { Effect, Layer } from "effect";
import type { EnvironmentStorageError } from "#server/domain/environment-storage-error.contract";
import {
  type GitCommandRunner,
  GitCommands,
} from "#server/domain/git-command.contract";
import {
  RepositoryAccess,
  RepositoryAccessError,
  type RepositoryAccessService,
} from "#server/domain/repository-access.contract";
import {
  type RepositoryCatalog,
  RepositoryCatalogAccess,
} from "#server/domain/repository-catalog.contract";
import type { RepositoryGitError } from "#server/domain/repository-git.contract";
import {
  type RepositoryWatcher,
  RepositoryWatching,
} from "#server/domain/repository-watcher.contract";
import {
  canonicalizeWorktrees,
  readWorktrees,
} from "#server/repository/access/git/read-worktrees";
import { createWorktreePathCache } from "#server/repository/access/worktree-path-cache";

export function createRepositoryAccess(
  catalog: Pick<RepositoryCatalog, "find">,
  git: GitCommandRunner,
  watcher: RepositoryWatcher,
): RepositoryAccessService {
  const worktreePaths = createWorktreePathCache(git, watcher);
  const repository = (repositoryId: string) =>
    catalog
      .find(repositoryId)
      .pipe(
        Effect.flatMap((entry) =>
          entry === undefined
            ? Effect.fail(repositoryMissing(repositoryId))
            : Effect.succeed(entry),
        ),
      );
  const worktrees = (repositoryPath: string) =>
    readWorktrees(git, repositoryPath).pipe(
      Effect.flatMap(canonicalizeWorktrees),
      Effect.mapError(worktreesUnreadable),
    );
  return {
    repository,
    worktrees,
    requireWorktree: (scope) =>
      Effect.gen(function* () {
        const entry = yield* repository(scope.repositoryId).pipe(
          Effect.mapError((error) =>
            error._tag === "EnvironmentStorageError"
              ? catalogUnavailable(error)
              : error,
          ),
        );
        const known = yield* worktreePaths
          .contains(entry.path, scope.worktreePath)
          .pipe(Effect.mapError(worktreesUnreadable));
        if (!known)
          return yield* Effect.fail(worktreeMissing(scope.worktreePath));
      }),
  };
}

export const repositoryAccessLayer = Layer.effect(
  RepositoryAccess,
  Effect.gen(function* () {
    return createRepositoryAccess(
      yield* RepositoryCatalogAccess,
      yield* GitCommands,
      yield* RepositoryWatching,
    );
  }),
);

function catalogUnavailable(cause: EnvironmentStorageError) {
  return new RepositoryAccessError({
    detail: "Could not find this repository.",
    failure: { _tag: "CatalogUnavailable", cause },
  });
}

function repositoryMissing(repositoryId: string) {
  return new RepositoryAccessError({
    detail: "This repository is no longer available.",
    failure: { _tag: "RepositoryMissing", repositoryId },
  });
}

function worktreesUnreadable(cause: RepositoryGitError) {
  return new RepositoryAccessError({
    detail: "Could not read the repository worktrees.",
    failure: { _tag: "WorktreesUnreadable", cause },
  });
}

function worktreeMissing(worktreePath: string) {
  return new RepositoryAccessError({
    detail: "This worktree does not belong to the repository.",
    failure: { _tag: "WorktreeMissing", worktreePath },
  });
}
