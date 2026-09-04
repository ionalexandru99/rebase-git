import type { RepositoryCatalogEntry } from "@rebase/contracts";
import { Effect } from "effect";
import type { GitCommandRunner } from "#server/domain/git-command.contract";
import type { RepositoryCatalog } from "#server/domain/repository-catalog.contract";
import {
  RepositoryHistoryError,
  type RepositoryHistoryService,
} from "#server/domain/repository-history.contract";
import { readRepositoryHistory } from "#server/features/repository-history/git/read-repository-history";
import { synchronizeRepositoryHistory } from "#server/features/repository-history/git/synchronize-repository-history";

export function createRepositoryHistoryService(dependencies: {
  readonly catalog: RepositoryCatalog;
  readonly git: GitCommandRunner;
}): RepositoryHistoryService {
  const findRepository = (repositoryId: string) =>
    dependencies.catalog.find(repositoryId).pipe(
      Effect.flatMap((repository: RepositoryCatalogEntry | undefined) =>
        repository === undefined
          ? Effect.fail(
              new RepositoryHistoryError({
                failure: { _tag: "RepositoryMissing", repositoryId },
              }),
            )
          : Effect.succeed(repository),
      ),
    );
  return {
    read: (request) =>
      findRepository(request.repositoryId).pipe(
        Effect.flatMap((repository) =>
          readRepositoryHistory(dependencies.git, repository.path, request),
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
      ),
  };
}
