import { Effect, Layer } from "effect";
import {
  type GitCommandRunner,
  GitCommands,
} from "#server/domain/git-command.contract";
import {
  RepositoryAccess,
  type RepositoryAccessService,
} from "#server/domain/repository-access.contract";
import {
  RepositoryHistoryAccess,
  RepositoryHistoryError,
  type RepositoryHistoryService,
} from "#server/domain/repository-history.contract";
import { historyGitFailed } from "#server/features/repository-history/git/history-failures";
import { readRepositoryHistory } from "#server/features/repository-history/git/read-repository-history";
import { synchronizeRepositoryHistory } from "#server/features/repository-history/git/synchronize-repository-history";

export function createRepositoryHistoryService(dependencies: {
  readonly access: RepositoryAccessService;
  readonly git: GitCommandRunner;
}): RepositoryHistoryService {
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
    read: (request) =>
      findRepository(request.repositoryId).pipe(
        Effect.flatMap((repository) =>
          readRepositoryHistory(dependencies.git, repository.path, request),
        ),
        Effect.catchTag("RepositoryGitError", (error) =>
          Effect.fail(historyGitFailed(error)),
        ),
      ),
    synchronize: (request, emit) =>
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

export const repositoryHistoryLayer = Layer.effect(
  RepositoryHistoryAccess,
  Effect.gen(function* () {
    return createRepositoryHistoryService({
      access: yield* RepositoryAccess,
      git: yield* GitCommands,
    });
  }),
);
