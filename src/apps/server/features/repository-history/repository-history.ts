import type {
  ReadRepositoryHistory,
  RepositoryHistoryBatch,
  RepositoryHistoryOperationFailure,
  SynchronizeRepositoryHistory,
} from "@rebase/contracts";
import { Effect } from "effect";
import type { GitCommandRunner } from "#server/adapters/local-git/git-commands";
import { createObjectFormatCache } from "#server/features/repository-history/git/read-object-format";
import { readRepositoryHistory } from "#server/features/repository-history/git/read-repository-history";
import { synchronizeRepositoryHistory } from "#server/features/repository-history/git/synchronize-repository-history";
import type { RepositoryAccess } from "#server/repository/repository-access";

export type RepositoryHistoryService = ReturnType<
  typeof createRepositoryHistoryService
>;

export function createRepositoryHistoryService(dependencies: {
  readonly access: RepositoryAccess;
  readonly git: GitCommandRunner;
}) {
  const objectFormat = createObjectFormatCache(dependencies.git);
  const findRepository = (repositoryId: string) =>
    dependencies.access
      .repository(repositoryId)
      .pipe(
        Effect.mapError(
          (error): RepositoryHistoryOperationFailure =>
            error._tag === "RepositoryRejected"
              ? { _tag: "RepositoryMissing", repositoryId }
              : { _tag: "GitFailed", reason: "Failed" },
        ),
      );
  return {
    read: (request: ReadRepositoryHistory) =>
      findRepository(request.repositoryId).pipe(
        Effect.flatMap((repository) =>
          readRepositoryHistory(
            dependencies.git,
            repository.path,
            request,
            objectFormat(repository.path),
          ),
        ),
      ),
    synchronize: (
      request: SynchronizeRepositoryHistory,
      emit: (
        batch: RepositoryHistoryBatch,
      ) => Effect.Effect<void, RepositoryHistoryOperationFailure>,
    ) =>
      findRepository(request.repositoryId).pipe(
        Effect.flatMap((repository) =>
          synchronizeRepositoryHistory(
            dependencies.git,
            repository.path,
            request,
            emit,
            objectFormat(repository.path),
          ),
        ),
      ),
  };
}
