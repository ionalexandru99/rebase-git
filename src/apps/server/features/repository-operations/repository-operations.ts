import type { ExecuteOperation, OperationScope } from "@rebase/contracts";
import { Effect } from "effect";
import type { GitCommandRunner } from "#server/domain/git-command.contract";
import type { RepositoryAccessService } from "#server/domain/repository-access.contract";
import type { RepositoryCoordinationService } from "#server/domain/repository-coordination.contract";
import {
  coordinationFailed,
  operationError,
  type RepositoryOperationError,
} from "#server/features/repository-operations/git/operation-failures";
import { recoverRepositoryOperation } from "#server/features/repository-operations/git/recover-operation";
import { recoverWritePolicy } from "#server/features/repository-operations/repository-operations.write-policy";

export function createRepositoryOperationsService(
  access: RepositoryAccessService,
  git: GitCommandRunner,
  coordination: RepositoryCoordinationService,
) {
  const inWorktree = <A>(
    scope: OperationScope,
    run: Effect.Effect<A, RepositoryOperationError>,
  ) =>
    access.requireWorktree(scope).pipe(
      Effect.mapError((error) => operationError("Missing", error.detail)),
      Effect.andThen(run),
    );
  return {
    read: (scope: OperationScope) =>
      inWorktree(
        scope,
        coordination
          .operation(scope.worktreePath)
          .pipe(Effect.mapError(coordinationFailed)),
      ),
    execute: (command: ExecuteOperation) =>
      inWorktree(
        command,
        coordination
          .run(
            command.worktreePath,
            recoverWritePolicy,
            recoverRepositoryOperation(git, coordination, command),
          )
          .pipe(
            Effect.mapError((error) =>
              error._tag === "RepositoryCoordinationError"
                ? coordinationFailed(error)
                : error,
            ),
          ),
      ),
  };
}
