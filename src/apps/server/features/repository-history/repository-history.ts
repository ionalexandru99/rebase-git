import type { RepositoryCatalogEntry } from "@rebase/contracts";
import { Effect } from "effect";
import type { GitCommandRunner } from "#server/domain/git-command.contract";
import type { RepositoryCatalog } from "#server/domain/repository-catalog.contract";
import {
  RepositoryHistoryError,
  type RepositoryHistoryService,
} from "#server/domain/repository-history.contract";
import { readRepositoryHistory } from "#server/features/repository-history/git/read-repository-history";

export function createRepositoryHistoryService(dependencies: {
  readonly catalog: RepositoryCatalog;
  readonly git: GitCommandRunner;
}): RepositoryHistoryService {
  return {
    read: (request) =>
      dependencies.catalog.find(request.repositoryId).pipe(
        Effect.flatMap((repository: RepositoryCatalogEntry | undefined) =>
          repository === undefined
            ? Effect.fail(
                new RepositoryHistoryError({
                  failure: {
                    _tag: "RepositoryMissing",
                    repositoryId: request.repositoryId,
                  },
                }),
              )
            : readRepositoryHistory(dependencies.git, repository.path, request),
        ),
      ),
  };
}
