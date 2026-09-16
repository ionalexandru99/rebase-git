import type { OperationScope } from "@rebase/contracts/repository-operations/repository-operations.contract";
import { Effect, Layer } from "effect";
import type { GitCommandRunner } from "#server/domain/git-command.contract";
import { GitCommands } from "#server/domain/git-command.contract";
import type { RepositoryCatalog } from "#server/domain/repository-catalog.contract";
import { RepositoryCatalogAccess } from "#server/domain/repository-catalog.contract";
import type { RepositoryOperationsService } from "#server/domain/repository-operations.contract";
import { RepositoryOperations } from "#server/domain/repository-operations.contract";
import type { RepositoryWritesService } from "#server/domain/repository-writes.contract";
import { RepositoryWrites } from "#server/domain/repository-writes.contract";
import { operationError } from "#server/features/repository-operations/git/operation-errors";
import { readRepositoryOperation } from "#server/features/repository-operations/git/read-operation";
import { recoverRepositoryOperation } from "#server/features/repository-operations/git/recover-operation";
import {
  canonicalizeWorktrees,
  readWorktrees,
} from "#server/features/repository-refs/git/read-repository-refs";

export function createRepositoryOperationsService({
  catalog,
  git,
  writes,
}: {
  readonly catalog: Pick<RepositoryCatalog, "find">;
  readonly git: GitCommandRunner;
  readonly writes: RepositoryWritesService;
}): RepositoryOperationsService {
  const validate = (scope: OperationScope) =>
    Effect.gen(function* () {
      const repository = yield* catalog
        .find(scope.repositoryId)
        .pipe(
          Effect.mapError(() =>
            operationError("Missing", "Repository is unavailable."),
          ),
        );
      if (!repository)
        return yield* Effect.fail(
          operationError("Missing", "Repository is unavailable."),
        );
      const worktrees = yield* readWorktrees(git, repository.path).pipe(
        Effect.flatMap(canonicalizeWorktrees),
        Effect.mapError(() =>
          operationError("Missing", "Could not find this worktree."),
        ),
      );
      if (!worktrees.some((tree) => tree.path === scope.worktreePath))
        return yield* Effect.fail(
          operationError(
            "Missing",
            "This worktree does not belong to the repository.",
          ),
        );
    });
  return {
    read: (scope) =>
      validate(scope).pipe(
        Effect.andThen(readRepositoryOperation(git, scope.worktreePath)),
      ),
    execute: (command) =>
      validate(command).pipe(
        Effect.andThen(
          writes.run(
            command.worktreePath,
            "recover",
            recoverRepositoryOperation(git, command),
          ),
        ),
      ),
  };
}

export const repositoryOperationsLayer = Layer.effect(
  RepositoryOperations,
  Effect.gen(function* () {
    return createRepositoryOperationsService({
      catalog: yield* RepositoryCatalogAccess,
      git: yield* GitCommands,
      writes: yield* RepositoryWrites,
    });
  }),
);
