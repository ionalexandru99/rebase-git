import { Effect, Layer } from "effect";
import type { EnvironmentStorageError } from "#server/domain/environment-storage-error.contract";
import {
  type GitCommandError,
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
import type { RepositoryGitExitError } from "#server/domain/repository-git.contract";
import {
  canonicalizeWorktrees,
  readWorktrees,
} from "#server/features/repository-access/git/read-worktrees";

export function createRepositoryAccess(
  catalog: Pick<RepositoryCatalog, "find">,
  git: GitCommandRunner,
): RepositoryAccessService {
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
    worktree: (scope) =>
      Effect.gen(function* () {
        const entry = yield* repository(scope.repositoryId).pipe(
          Effect.mapError((error) =>
            error._tag === "EnvironmentStorageError"
              ? catalogUnavailable(error)
              : error,
          ),
        );
        const worktree = (yield* worktrees(entry.path)).find(
          (tree) => tree.path === scope.worktreePath,
        );
        return worktree === undefined
          ? yield* Effect.fail(worktreeMissing(scope.worktreePath))
          : worktree;
      }),
  };
}

export const repositoryAccessLayer = Layer.effect(
  RepositoryAccess,
  Effect.gen(function* () {
    return createRepositoryAccess(
      yield* RepositoryCatalogAccess,
      yield* GitCommands,
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

function worktreesUnreadable(cause: GitCommandError | RepositoryGitExitError) {
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
