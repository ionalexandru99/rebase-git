import { Effect, Layer } from "effect";
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
import {
  canonicalizeWorktrees,
  readWorktrees,
} from "#server/features/repository-access/git/read-worktrees";

export function createRepositoryAccess(
  catalog: Pick<RepositoryCatalog, "find">,
  git: GitCommandRunner,
): RepositoryAccessService {
  return {
    worktree: (scope) =>
      Effect.gen(function* () {
        const repository = yield* catalog.find(scope.repositoryId).pipe(
          Effect.mapError(
            () =>
              new RepositoryAccessError({
                detail: "Could not find this repository.",
              }),
          ),
        );
        if (repository === undefined) {
          return yield* Effect.fail(
            new RepositoryAccessError({
              detail: "This repository is no longer available.",
            }),
          );
        }
        const worktrees = yield* readWorktrees(git, repository.path).pipe(
          Effect.flatMap(canonicalizeWorktrees),
          Effect.mapError(
            () =>
              new RepositoryAccessError({
                detail: "Could not read the repository worktrees.",
              }),
          ),
        );
        const worktree = worktrees.find(
          (tree) => tree.path === scope.worktreePath,
        );
        if (worktree === undefined) {
          return yield* Effect.fail(
            new RepositoryAccessError({
              detail: "This worktree does not belong to the repository.",
            }),
          );
        }
        return worktree;
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
