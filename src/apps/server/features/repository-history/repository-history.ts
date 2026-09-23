import type {
  ReadRepositoryHistory,
  RepositoryHistoryBatch,
  SynchronizeRepositoryHistory,
} from "@rebase/contracts";
import { Effect } from "effect";
import type { GitCommandRunner } from "#server/domain/git-command.contract";
import type { RepositoryAccessService } from "#server/domain/repository-access.contract";
import {
  historyGitFailed,
  RepositoryHistoryError,
} from "#server/features/repository-history/git/history-failures";
import { readRepositoryHistory } from "#server/features/repository-history/git/read-repository-history";
import { synchronizeRepositoryHistory } from "#server/features/repository-history/git/synchronize-repository-history";

export type RepositoryHistoryService = ReturnType<
  typeof createRepositoryHistoryService
>;

export function createRepositoryHistoryService(dependencies: {
  readonly access: RepositoryAccessService;
  readonly git: GitCommandRunner;
}) {
  const findRepository = (repositoryId: string) =>
    dependencies.access.repository(repositoryId).pipe(
      Effect.mapError((error) =>
        error._tag === "RepositoryAccessError"
          ? new RepositoryHistoryError({
              failure: { _tag: "RepositoryMissing", repositoryId },
            })
          : error,
      ),
    );
  return {
    read: (request: ReadRepositoryHistory) =>
      findRepository(request.repositoryId).pipe(
        Effect.flatMap((repository) =>
          readRepositoryHistory(dependencies.git, repository.path, request),
        ),
        Effect.catchTag("RepositoryGitError", (error) =>
          Effect.fail(historyGitFailed(error)),
        ),
      ),
    synchronize: (
      request: SynchronizeRepositoryHistory,
      emit: (
        batch: RepositoryHistoryBatch,
      ) => Effect.Effect<void, RepositoryHistoryError>,
    ) =>
      findRepository(request.repositoryId).pipe(
        Effect.flatMap((repository) =>
          synchronizeRepositoryHistory(
            dependencies.git,
            repository.path,
            request,
            emit,
          ),
        ),
        Effect.catchTag("RepositoryGitError", (error) =>
          Effect.fail(historyGitFailed(error)),
        ),
      ),
  };
}
